import { useState, useRef, useContext, createContext, useEffect } from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { Globe } from 'lucide-react';

// Brand SVG icons (not in this lucide version)
const GithubIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

const TwitterIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const LinkedinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

const FarcasterIcon = () => (
  <img src="/farcaster.png" alt="Farcaster" width={12} height={12} className="object-contain" />
);

const MouseContext = createContext({ x: 0, y: 0 });

function DockIcon({ icon, label, href, onClick }) {
  const ref      = useRef(null);
  const mouse    = useContext(MouseContext);
  const distance = useMotionValue(Infinity);

  useEffect(() => {
    if (!ref.current || (mouse.x === 0 && mouse.y === 0)) {
      distance.set(Infinity);
      return;
    }
    const iconRect      = ref.current.getBoundingClientRect();
    const parentRect    = ref.current.parentElement?.getBoundingClientRect();
    if (!parentRect) return;
    const iconCenterX   = iconRect.left + iconRect.width / 2;
    const mouseXAbs     = parentRect.left + mouse.x;
    distance.set(Math.abs(mouseXAbs - iconCenterX));
  }, [mouse, distance]);

  const size    = useTransform(distance, [0, 80], [36, 26]);
  const springS = useSpring(size, { mass: 0.1, stiffness: 180, damping: 14 });

  function handleClick() {
    if (href) window.open(href, '_blank', 'noopener noreferrer');
    onClick?.();
  }

  return (
    <div className="flex flex-col items-center gap-1.5 group">
      <motion.button
        ref={ref}
        style={{ width: springS, height: springS }}
        onClick={handleClick}
        title={label}
        className="rounded-2xl bg-surface border border-border
          hover:border-accent/40 hover:bg-accent/10
          flex items-center justify-center
          text-muted hover:text-accent
          transition-colors duration-150 cursor-pointer shrink-0"
      >
        {icon}
      </motion.button>
      <span className="text-[9px] font-mono text-muted/0 group-hover:text-muted/70
        transition-all duration-150 leading-none select-none">
        {label}
      </span>
    </div>
  );
}

/**
 * MagneticDock — shows contractor social links as a macOS-style dock.
 * Pass in the profile object; only icons with data are rendered.
 */
export default function MagneticDock({ profile }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const items = [
    profile?.github    && { id: 'github',    label: 'GitHub',    icon: <GithubIcon />,           href: `https://github.com/${profile.github}` },
    profile?.twitter   && { id: 'twitter',   label: 'X',         icon: <TwitterIcon />,          href: `https://x.com/${profile.twitter}` },
    profile?.linkedin  && { id: 'linkedin',  label: 'LinkedIn',  icon: <LinkedinIcon />,         href: `https://linkedin.com/in/${profile.linkedin}` },
    profile?.farcaster && { id: 'farcaster', label: 'Farcaster', icon: <FarcasterIcon />,        href: `https://warpcast.com/${profile.farcaster}` },
    profile?.website   && { id: 'website',   label: 'Website',   icon: <Globe size={12} />,      href: profile.website },
  ].filter(Boolean);

  if (!items.length) return null;

  return (
    <MouseContext.Provider value={pos}>
      <div
        onMouseMove={e => {
          const { clientX, currentTarget } = e;
          const { left } = currentTarget.getBoundingClientRect();
          setPos({ x: clientX - left, y: 0 });
        }}
        onMouseLeave={() => setPos({ x: 0, y: 0 })}
        className="flex items-end gap-2 pb-1"
      >
        {items.map(item => (
          <DockIcon key={item.id} {...item} />
        ))}
      </div>
    </MouseContext.Provider>
  );
}
