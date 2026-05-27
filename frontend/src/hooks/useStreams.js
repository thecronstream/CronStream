import { useEffect, useState } from 'react';
import { usePublicClient, useAccount, useChainId } from 'wagmi';
import { parseAbiItem, keccak256, toHex, decodeAbiParameters } from 'viem';
import { getContractAddress, CONTRACT_ADDRESSES } from '../lib/wagmi';

const AGENT_URL    = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:3000';
const BS_API_KEY   = import.meta.env.VITE_BLOCKSCOUT_API_KEY ?? '';

// Blockscout base URLs — only chains indexed by Blockscout
const BLOCKSCOUT_BASE = {
  421614: 'https://arbitrum-sepolia.blockscout.com',
};

// keccak256("StreamCreated(bytes32,address,address,uint256)")
const STREAM_CREATED_TOPIC0 = keccak256(
  toHex('StreamCreated(bytes32,address,address,uint256)')
);

const STREAM_CREATED = parseAbiItem(
  'event StreamCreated(bytes32 indexed streamId, address indexed sender, address indexed recipient, uint256 ratePerSecond)'
);

function mapLog(l, chainId) {
  return {
    streamId:      l.args.streamId,
    sender:        l.args.sender,
    recipient:     l.args.recipient,
    ratePerSecond: l.args.ratePerSecond ?? 0n,
    blockNumber:   l.blockNumber,
    chainId,
  };
}

function mapDbRow(r) {
  // The server merges DB row (snake_case) with on-chain data (camelCase from ethers).
  // We handle both naming styles so old and new responses both work.
  function bi(v) { try { return v != null ? BigInt(v) : null; } catch { return null; } }

  return {
    streamId:         r.stream_id,
    sender:           r.sender          ?? null,
    recipient:        r.recipient       ?? null,
    token:            r.token           ?? null,
    ratePerSecond:    bi(r.ratePerSecond)    ?? bi(r.rate_per_second)    ?? 0n,
    startTime:        bi(r.startTime)        ?? bi(r.start_time)         ?? 0n,
    streamValidUntil: bi(r.streamValidUntil) ?? bi(r.stream_valid_until) ?? 0n,
    totalDeposited:   bi(r.totalDeposited)   ?? bi(r.total_deposited)    ?? 0n,
    totalWithdrawn:   bi(r.totalWithdrawn)   ?? bi(r.total_withdrawn)    ?? 0n,
    rawBalance:       bi(r.balance)          ?? null,   // null = not yet fetched
    blockNumber:      null,
    chainId:          r.chain_id ? Number(r.chain_id) : null,
  };
}

/**
 * Fetch StreamCreated events for an address from Blockscout.
 * Returns { sent: [...], received: [...] } or null on failure.
 */
async function fetchFromBlockscout(address, chainId) {
  const base = BLOCKSCOUT_BASE[chainId];
  if (!base) return null;

  const contractAddress = getContractAddress(chainId);
  const paddedAddress   = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0');

  try {
    const allItems = [];
    let pageParams = null;

    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams();
      if (BS_API_KEY) qs.set('apikey', BS_API_KEY);
      if (pageParams) {
        Object.entries(pageParams).forEach(([k, v]) => qs.set(k, String(v)));
      }

      const url = `${base}/api/v2/addresses/${contractAddress}/logs?${qs}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Blockscout ${res.status}`);
      const json = await res.json();

      // Keep only StreamCreated events involving this address
      const matching = (json.items ?? []).filter(item => {
        const t = item.topics ?? [];
        return (
          t[0]?.toLowerCase() === STREAM_CREATED_TOPIC0.toLowerCase() &&
          (t[2]?.toLowerCase() === paddedAddress.toLowerCase() ||
           t[3]?.toLowerCase() === paddedAddress.toLowerCase())
        );
      });
      allItems.push(...matching);

      if (!json.next_page_params) break;
      pageParams = json.next_page_params;
    }

    // Decode each log
    const parsed = allItems.map(item => {
      const t = item.topics ?? [];
      let ratePerSecond = 0n;
      try {
        [ratePerSecond] = decodeAbiParameters([{ type: 'uint256' }], item.data);
      } catch { /* skip */ }

      // topics: [topic0, streamId, sender, recipient]
      const rawSender    = t[2] ? '0x' + t[2].slice(-40) : null;
      const rawRecipient = t[3] ? '0x' + t[3].slice(-40) : null;

      return {
        streamId:      t[1] ?? null,         // bytes32 stream ID
        sender:        rawSender,
        recipient:     rawRecipient,
        ratePerSecond,
        blockNumber:   BigInt(item.block_number ?? 0),
        chainId:       Number(chainId),
      };
    });

    const addrLow = address.toLowerCase();
    return {
      sent:     parsed.filter(s => s.sender?.toLowerCase()    === addrLow),
      received: parsed.filter(s => s.recipient?.toLowerCase() === addrLow),
    };
  } catch (err) {
    console.warn('[useStreams] Blockscout fallback error:', err.message);
    return null;
  }
}

/**
 * Fetches StreamCreated events for the connected wallet.
 *
 * Priority:
 *  1. Agent DB  — /api/v1/streams?address=0x...  (fast, no RPC limits)
 *  2. Blockscout — for Arb Sepolia (no block-range limits, indexes all history)
 *  3. viem getLogs fallback — for other chains, last ~7 days
 */
export function useStreams() {
  const { address } = useAccount();
  const client  = usePublicClient();
  const chainId = useChainId();

  const [sent,     setSent]     = useState([]);
  const [received, setReceived] = useState([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!address || !client) return;

    let cancelled = false;

    async function load() {
      setLoading(true);

      // ── 1. Try agent DB ──────────────────────────────────────────────────
      try {
        const res = await fetch(
          `${AGENT_URL}/api/v1/streams?address=${address}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const { streams } = await res.json();
          // Only use DB result if it actually has streams (non-empty)
          if (!cancelled && streams?.length > 0) {
            const addrLow = address.toLowerCase();
            setSent    (streams.filter(s => s.sender?.toLowerCase()    === addrLow).map(mapDbRow));
            setReceived(streams.filter(s => s.recipient?.toLowerCase() === addrLow).map(mapDbRow));
            setLoading(false);
            return;
          }
        }
      } catch {
        // Agent offline — fall through
      }

      // ── 2. Blockscout (Arb Sepolia — all historical blocks, no RPC limit) ──
      // Always try Arb Sepolia on Blockscout even if wallet is on another chain,
      // because the user's streams may have been created on Arb Sepolia.
      const bsResult = await fetchFromBlockscout(address, 421614);
      if (bsResult && (bsResult.sent.length > 0 || bsResult.received.length > 0)) {
        if (!cancelled) {
          setSent    (bsResult.sent);
          setReceived(bsResult.received);
          setLoading(false);
          return;
        }
      }

      // ── 3. viem fallback (current wallet chain) ──────────────────────────
      // Useful for non-Blockscout chains (e.g. Robinhood). Block range is capped
      // to avoid RPC rejection on chains with millions of blocks.
      try {
        const contractAddress = getContractAddress(chainId);
        const currentBlock    = await client.getBlockNumber();
        // ~7 days on Arb Sepolia (4 blocks/s) or Robinhood Chain (2 blocks/s)
        const lookback  = 2_500_000n;
        const fromBlock = currentBlock > lookback ? currentBlock - lookback : 0n;

        const [sentLogs, receivedLogs] = await Promise.all([
          client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { sender: address },    fromBlock, toBlock: 'latest' }),
          client.getLogs({ address: contractAddress, event: STREAM_CREATED, args: { recipient: address }, fromBlock, toBlock: 'latest' }),
        ]);

        if (!cancelled) {
          setSent    (sentLogs.map(l => mapLog(l, chainId)));
          setReceived(receivedLogs.map(l => mapLog(l, chainId)));
        }
      } catch (err) {
        console.error('useStreams viem fallback error:', err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [address, client, chainId]);

  return { sent, received, loading };
}
