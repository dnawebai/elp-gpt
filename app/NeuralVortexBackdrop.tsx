'use client';

import { useEffect, useRef } from 'react';

const rings = [72, 98, 126, 158, 194, 236, 282, 332];
const spokeAngles = Array.from({ length: 24 }, (_, index) => index * 15);
const tickAngles = Array.from({ length: 72 }, (_, index) => index * 5);
const nodes = [
  [184, 516, 5], [258, 362, 6], [338, 438, 4], [642, 476, 5], [714, 326, 4],
  [734, 624, 6], [692, 944, 4], [606, 1120, 6], [480, 1250, 5], [286, 1186, 4],
  [182, 1018, 6], [116, 782, 4], [762, 784, 4], [402, 286, 5], [550, 244, 4],
];
const hexes = [
  [306, 324, 34], [354, 300, 28], [395, 332, 26], [338, 372, 22],
  [690, 210, 42], [748, 258, 46], [698, 308, 38],
  [176, 1184, 40], [226, 1232, 34], [146, 1248, 28],
  [594, 1310, 34], [640, 1348, 28], [692, 1316, 24], [626, 1398, 22],
];

function hexPoints(cx: number, cy: number, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 6;
    return `${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`;
  }).join(' ');
}

export default function NeuralVortexBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    let frame = 0;
    const onPointerMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        element.style.setProperty('--nv-x', x.toFixed(3));
        element.style.setProperty('--nv-y', y.toFixed(3));
      });
    };
    const reset = () => {
      element.style.setProperty('--nv-x', '0');
      element.style.setProperty('--nv-y', '0');
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('blur', reset);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return (
    <div ref={rootRef} className="neural-vortex-bg" aria-hidden="true">
      <div className="nv-parallax">
        <svg className="nv-art" viewBox="0 0 900 1600" preserveAspectRatio="xMidYMid slice" role="presentation">
          <defs>
            <radialGradient id="nvBg" cx="50%" cy="49%" r="72%">
              <stop offset="0%" stopColor="#06343c" />
              <stop offset="34%" stopColor="#031a21" />
              <stop offset="70%" stopColor="#010a0e" />
              <stop offset="100%" stopColor="#000609" />
            </radialGradient>
            <linearGradient id="nvCyan" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3effff" />
              <stop offset="52%" stopColor="#00dfea" />
              <stop offset="100%" stopColor="#0aa5c0" />
            </linearGradient>
            <linearGradient id="nvBeam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00ecff" stopOpacity="0" />
              <stop offset="50%" stopColor="#28f7ff" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#00ecff" stopOpacity="0" />
            </linearGradient>
            <filter id="nvGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="nvSoft" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="18" />
            </filter>
            <pattern id="nvGrid" width="38" height="38" patternUnits="userSpaceOnUse">
              <path d="M 38 0 L 0 0 0 38" fill="none" stroke="#25e7f3" strokeOpacity="0.035" strokeWidth="1" />
            </pattern>
          </defs>

          <rect width="900" height="1600" fill="url(#nvBg)" />
          <rect width="900" height="1600" fill="url(#nvGrid)" />

          <g className="nv-beams" opacity="0.9">
            <path d="M-130 1520 L530 -80 L650 -80 L-10 1600 Z" fill="url(#nvBeam)" opacity="0.42" />
            <path d="M480 1640 L980 70 L1060 100 L570 1640 Z" fill="url(#nvBeam)" opacity="0.24" />
            <path d="M-120 260 L1000 80" stroke="url(#nvBeam)" strokeWidth="42" opacity="0.16" />
          </g>

          <g className="nv-chemistry" fill="none" stroke="url(#nvCyan)" strokeOpacity="0.33" strokeWidth="2">
            {hexes.map(([cx, cy, radius], index) => <polygon key={index} points={hexPoints(cx, cy, radius)} />)}
            <path d="M385 324 H512 M512 324 V398 M512 398 H588" />
            <path d="M705 210 H792 M145 1248 H92 M626 1398 H734" />
          </g>

          <g className="nv-network" stroke="#21edf5" strokeOpacity="0.16" fill="none">
            <path d="M125 520 C280 480 315 390 450 370 S670 390 790 470" />
            <path d="M84 1030 C240 980 306 1040 450 1060 S666 1000 816 920" />
            <path d="M208 286 L282 384 L218 500 M686 310 L632 430 L718 536" />
          </g>

          <g className="nv-vortex" transform="translate(450 812)">
            <circle r="382" fill="none" stroke="#00dce8" strokeOpacity="0.12" strokeWidth="2" />
            <circle r="356" fill="none" stroke="#17f3ff" strokeOpacity="0.17" strokeWidth="1" />

            <g className="nv-rotor nv-rotor-slow">
              <circle r="330" fill="none" stroke="url(#nvCyan)" strokeOpacity="0.34" strokeWidth="4" strokeDasharray="220 70 40 100 165 84" />
              <circle r="304" fill="none" stroke="#31f5ff" strokeOpacity="0.22" strokeWidth="2" strokeDasharray="26 18" />
            </g>

            <g className="nv-rotor nv-rotor-reverse">
              <circle r="278" fill="none" stroke="#19edf7" strokeOpacity="0.56" strokeWidth="7" strokeDasharray="160 54 18 42 90 70" />
              <circle r="254" fill="none" stroke="#1dd8ef" strokeOpacity="0.24" strokeWidth="2" strokeDasharray="86 34 16 55" />
            </g>

            <g className="nv-spokes">
              {spokeAngles.map((angle) => (
                <g key={angle} transform={`rotate(${angle})`}>
                  <line x1="70" y1="0" x2="350" y2="0" stroke="#0de7f1" strokeOpacity={angle % 45 === 0 ? '0.30' : '0.10'} strokeWidth={angle % 45 === 0 ? '2' : '1'} />
                  {angle % 30 === 0 && <circle cx="328" cy="0" r="4" fill="#3cffff" fillOpacity="0.62" />}
                </g>
              ))}
            </g>

            <g className="nv-ticks">
              {tickAngles.map((angle) => (
                <line key={angle} x1="0" y1="-238" x2="0" y2={angle % 25 === 0 ? '-224' : '-230'} transform={`rotate(${angle})`} stroke="#40fbff" strokeOpacity={angle % 25 === 0 ? '0.62' : '0.26'} strokeWidth={angle % 25 === 0 ? '2' : '1'} />
              ))}
            </g>

            <g className="nv-rotor nv-rotor-fast">
              {rings.map((radius, index) => (
                <circle key={radius} r={radius} fill="none" stroke={index % 2 ? '#18dbe7' : '#4effff'} strokeOpacity={0.14 + index * 0.035} strokeWidth={index % 3 === 0 ? 3 : 1.4} strokeDasharray={index % 2 ? '42 18 9 24' : '120 38 18 48'} />
              ))}
            </g>

            <circle r="50" fill="#01181e" fillOpacity="0.88" stroke="#5dffff" strokeOpacity="0.72" strokeWidth="3" filter="url(#nvGlow)" />
            <circle r="30" fill="none" stroke="#21edf5" strokeOpacity="0.86" strokeWidth="4" strokeDasharray="38 18" className="nv-core-ring" />
            <circle r="10" fill="#4cffff" fillOpacity="0.86" filter="url(#nvGlow)" />
            <circle r="92" fill="#08e6f0" fillOpacity="0.045" filter="url(#nvSoft)" />
          </g>

          <g className="nv-nodes" fill="#44fbff" filter="url(#nvGlow)">
            {nodes.map(([cx, cy, radius], index) => <circle key={index} cx={cx} cy={cy} r={radius} fillOpacity={index % 3 === 0 ? '0.80' : '0.52'} />)}
          </g>

          <g className="nv-data" fill="#55fbff" fillOpacity="0.35">
            <rect x="96" y="620" width="78" height="6" rx="3" /><rect x="112" y="640" width="112" height="3" rx="2" />
            <rect x="662" y="642" width="128" height="4" rx="2" /><rect x="700" y="662" width="72" height="3" rx="2" />
            <rect x="184" y="1018" width="102" height="4" rx="2" /><rect x="614" y="1058" width="136" height="4" rx="2" />
          </g>
        </svg>
      </div>
      <div className="nv-scanline" />
      <div className="nv-vignette" />
    </div>
  );
}
