/**
 * FlowDiagram — animated "How it works" visualization.
 *
 * Shows the 5-step CronStream flow as a canvas animation:
 *   Node circles connected by animated flowing lines.
 *   A glowing pulse travels along each connector in sequence.
 *   Active node pulses and highlights its label.
 */

import { useEffect, useRef, useState } from 'react';

const ACCENT   = '#00D4AA';
const ACCENT_DIM = 'rgba(0,212,170,0.15)';

const STEPS = [
  { step: '01', title: 'Company creates stream',   desc: 'Deposit full budget upfront. Set rate per second and duration.',                     icon: 'https://img.icons8.com/color/48/commercial-development-management.png' },
  { step: '02', title: 'Contractor ships code',    desc: 'Push commits, open PR, pass CI. Work is verifiable on GitHub.',                     icon: 'https://img.icons8.com/color/48/source-code.png' },
  { step: '03', title: 'Agent verifies milestone', desc: '3-layer check: code diff, merged PR, CI pass. All must pass.',                      icon: 'https://img.icons8.com/color/48/artificial-intelligence.png' },
  { step: '04', title: 'Stream window extends',    desc: 'Agent signs EIP-712 voucher and submits on-chain. Contractor earns another window.', icon: 'https://img.icons8.com/color/48/time.png' },
  { step: '05', title: 'Contractor withdraws',     desc: 'Pull earned tokens anytime. Protocol fee deducted automatically.',                   icon: 'https://img.icons8.com/color/48/receive-cash.png' },
];

// ─── Canvas pulse animation ───────────────────────────────────────────────────

function PulseCanvas({ activeIdx }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    let animId;
    let t = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }

    function draw() {
      const W = canvas.getBoundingClientRect().width;
      const H = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, W, H);

      const n   = STEPS.length;
      const pad = 40;
      const nodeR = 18;

      // Evenly space nodes across the width
      const xs = STEPS.map((_, i) => pad + (i / (n - 1)) * (W - pad * 2));
      const y  = H / 2;

      // Draw connector lines
      for (let i = 0; i < n - 1; i++) {
        const x1 = xs[i] + nodeR;
        const x2 = xs[i + 1] - nodeR;

        // Base line
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y);
        ctx.strokeStyle = i < activeIdx ? ACCENT : 'rgba(255,255,255,0.08)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Animated pulse on the active connector
        if (i === activeIdx) {
          const progress = (t % 1);
          const px = x1 + (x2 - x1) * progress;

          // Trail
          const tg = ctx.createLinearGradient(px - 40, y, px, y);
          tg.addColorStop(0, 'rgba(0,212,170,0)');
          tg.addColorStop(1, 'rgba(0,212,170,0.8)');
          ctx.beginPath();
          ctx.moveTo(px - 40, y);
          ctx.lineTo(px, y);
          ctx.strokeStyle = tg;
          ctx.lineWidth   = 2.5;
          ctx.stroke();

          // Pulse head
          ctx.beginPath();
          ctx.arc(px, y, 4, 0, Math.PI * 2);
          ctx.fillStyle   = ACCENT;
          ctx.shadowBlur  = 16;
          ctx.shadowColor = ACCENT;
          ctx.fill();
          ctx.shadowBlur  = 0;
        }
      }

      // Draw nodes
      STEPS.forEach((s, i) => {
        const x       = xs[i];
        const isActive = i === activeIdx;
        const isPast   = i < activeIdx;

        // Outer glow for active
        if (isActive) {
          const glow = ctx.createRadialGradient(x, y, 0, x, y, nodeR * 3);
          glow.addColorStop(0, 'rgba(0,212,170,0.25)');
          glow.addColorStop(1, 'rgba(0,212,170,0)');
          ctx.beginPath();
          ctx.arc(x, y, nodeR * 3, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Ring
        ctx.beginPath();
        ctx.arc(x, y, nodeR, 0, Math.PI * 2);
        ctx.strokeStyle = isActive ? ACCENT : isPast ? 'rgba(0,212,170,0.5)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth   = isActive ? 2 : 1.5;
        ctx.stroke();

        // Fill
        ctx.beginPath();
        ctx.arc(x, y, nodeR - 2, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? 'rgba(0,212,170,0.15)' : isPast ? 'rgba(0,212,170,0.06)' : 'rgba(255,255,255,0.03)';
        ctx.fill();

        // Step number
        ctx.fillStyle   = isActive ? ACCENT : isPast ? 'rgba(0,212,170,0.7)' : 'rgba(255,255,255,0.3)';
        ctx.font        = `${isActive ? 700 : 500} 10px "JetBrains Mono", monospace`;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.step, x, y);
      });

      t += 0.008;
      animId = requestAnimationFrame(draw);
    }

    resize();
    const ro = new ResizeObserver(() => { resize(); });
    ro.observe(canvas);

    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, [activeIdx]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '80px', display: 'block' }}
    />
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function FlowDiagram() {
  const [activeIdx, setActiveIdx] = useState(0);

  // Auto-advance through steps
  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx(i => (i + 1) % STEPS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  const active = STEPS[activeIdx];

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold text-center mb-2">How it works</h2>
      <p className="text-muted text-center mb-12 text-sm">Five steps. Zero trust required.</p>

      {/* Canvas flow */}
      <div className="border border-border rounded-2xl overflow-hidden bg-surface">

        {/* Step dots + connectors */}
        <div className="px-6 pt-8 pb-2">
          <PulseCanvas activeIdx={activeIdx} />
        </div>

        {/* Step labels row */}
        <div className="grid grid-cols-5 px-2 pb-4">
          {STEPS.map((s, i) => (
            <button
              key={s.step}
              onClick={() => setActiveIdx(i)}
              className={`flex flex-col items-center gap-1 px-1 py-2 rounded-xl transition-colors
                ${i === activeIdx ? 'text-accent' : 'text-muted hover:text-white'}`}
            >
              <img src={s.icon} alt={s.title} className="w-6 h-6 object-contain" />
              <span className="text-[10px] font-mono leading-tight text-center hidden sm:block">
                {s.title.split(' ').slice(0, 2).join(' ')}
              </span>
            </button>
          ))}
        </div>

        {/* Active step detail */}
        <div className="border-t border-border px-8 py-6 min-h-[100px] transition-all">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-10 h-10 rounded-full border border-accent/30 bg-accent/5
              flex items-center justify-center">
              <span className="font-mono text-accent text-xs font-bold">{active.step}</span>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-1">{active.title}</h3>
              <p className="text-muted text-sm leading-relaxed">{active.desc}</p>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex gap-1.5 mt-5 justify-end">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`h-1 rounded-full transition-all duration-300
                  ${i === activeIdx ? 'w-6 bg-accent' : 'w-1.5 bg-border hover:bg-muted'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
