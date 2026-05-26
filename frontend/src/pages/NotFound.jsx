import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const IMAGES = [
  '/404 Error Page not Found with people connecting a plug-bro.png',
  '/Oops! 404 Error with a broken robot-rafiki.png',
];

export default function NotFound() {
  const navigate = useNavigate();
  const [imgIdx, setImgIdx] = useState(() => Math.floor(Math.random() * IMAGES.length));
  const [visible, setVisible] = useState(false);

  // Fade-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Swap illustration every ~4 s with a crossfade
  useEffect(() => {
    const id = setInterval(() => {
      setImgIdx(i => (i + 1) % IMAGES.length);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={`min-h-screen bg-dark flex flex-col items-center justify-center px-6 text-center
        transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-[500px] h-[500px] rounded-full bg-accent/5 blur-[120px]" />
      </div>

      {/* Illustration */}
      <div className="relative mb-6 w-64 h-64 sm:w-80 sm:h-80">
        {IMAGES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt="404 illustration"
            className={`absolute inset-0 w-full h-full object-contain select-none
              transition-opacity duration-700
              ${i === imgIdx ? 'opacity-100' : 'opacity-0'}`}
            style={{ animationDuration: '3s' }}
          />
        ))}

        {/* Floating animation wrapper */}
        <div className="absolute inset-0 animate-[float_3s_ease-in-out_infinite]" />
      </div>

      {/* Error code */}
      <div className="relative mb-3">
        <span className="text-[96px] sm:text-[128px] font-black font-mono leading-none
          bg-gradient-to-b from-white/20 to-white/5 bg-clip-text text-transparent
          select-none pointer-events-none">
          404
        </span>
        {/* Glitch layers */}
        <span className="absolute inset-0 text-[96px] sm:text-[128px] font-black font-mono leading-none
          text-accent/20 select-none animate-[glitch1_4s_infinite]"
          aria-hidden="true">
          404
        </span>
        <span className="absolute inset-0 text-[96px] sm:text-[128px] font-black font-mono leading-none
          text-blue-400/10 select-none animate-[glitch2_4s_infinite]"
          aria-hidden="true">
          404
        </span>
      </div>

      {/* Copy */}
      <h1 className="text-xl sm:text-2xl font-bold mb-2 text-white">
        Page not found
      </h1>
      <p className="text-sm text-muted max-w-sm leading-relaxed mb-8">
        The stream you're looking for doesn't exist, expired, or got lost in the blocks.
        Let's get you back on-chain.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="btn-primary px-6 py-2.5 text-sm"
        >
          Go home
        </button>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2.5 text-sm rounded-xl border border-border text-muted
            hover:text-white hover:border-white/20 transition-colors"
        >
          ← Go back
        </button>
      </div>

      {/* Subtle brand */}
      <div className="mt-12 flex items-center gap-2 opacity-30">
        <img src="/logo.png" alt="" className="w-4 h-4 rounded object-contain" />
        <span className="text-xs font-mono text-muted">CronStream</span>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes glitch1 {
          0%, 90%, 100% { transform: translate(0); }
          92%            { transform: translate(-3px, 1px); }
          94%            { transform: translate(3px, -1px); }
          96%            { transform: translate(-1px, 2px); }
        }
        @keyframes glitch2 {
          0%, 88%, 100% { transform: translate(0); }
          90%            { transform: translate(3px, -2px); }
          93%            { transform: translate(-2px, 1px); }
          95%            { transform: translate(1px, -1px); }
        }
      `}</style>
    </div>
  );
}
