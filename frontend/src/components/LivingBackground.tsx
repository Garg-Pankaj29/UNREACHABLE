import React, { useEffect, useRef } from 'react';

interface LivingBackgroundProps {
  theme: 'light' | 'dark';
}

export const LivingBackground: React.FC<LivingBackgroundProps> = ({ theme }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Synthetic graph points
    const N: { x: number; y: number }[] = [];
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 5; i++) {
        N.push({ x: 130 + i * 185, y: 110 + j * 170 });
      }
    }

    const HW = [
      [6.5, 4.2, 2.6, 5.8],
      [7, 6.5, 3.1, null],
      [5.5, 2.2, 4.8, 6],
    ];
    const VW = [
      [6, 4, 7, 2.8, 5],
      [5, null, 6, 4.5, 3.2],
    ];

    interface Edge {
      id: string;
      a: number;
      b: number;
      w: number | null;
      i?: number;
    }

    const E: Edge[] = [];
    HW.forEach((r, j) =>
      r.forEach((w, i) =>
        E.push({ id: `h${j}-${i}`, a: j * 5 + i, b: j * 5 + i + 1, w })
      )
    );
    VW.forEach((r, j) =>
      r.forEach((w, i) =>
        E.push({ id: `v${j}-${i}`, a: j * 5 + i, b: j * 5 + i + 5, w })
      )
    );

    const ADJ: number[][] = N.map(() => []);
    E.forEach((e, i) => {
      e.i = i;
      ADJ[e.a].push(i);
      ADJ[e.b].push(i);
    });

    let W = window.innerWidth;
    let H = window.innerHeight;
    let sc = Math.max(W / 1000, H / 560) * 1.15;
    let ox = (W - 1000 * sc) / 2;
    let oy = (H - 560 * sc) / 2;
    let mx = 0;
    let my = 0;

    let K = {
      ink: theme === 'dark' ? '#eceee7' : '#1c1f1b',
      sig: theme === 'dark' ? '#ff4d63' : '#d7263d',
      tape: '#ffd60a',
    };

    function updateColors() {
      const isDark = document.documentElement.dataset.theme === 'dark';
      K = {
        ink: isDark ? '#eceee7' : '#1c1f1b',
        sig: isDark ? '#ff4d63' : '#d7263d',
        tape: '#ffd60a',
      };
    }

    function handleResize() {
      if (!canvas) return;
      const d = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * d;
      canvas.height = H * d;
      ctx?.setTransform(d, 0, 0, d, 0, 0);
      sc = Math.max(W / 1000, H / 560) * 1.15;
      ox = (W - 1000 * sc) / 2;
      oy = (H - 560 * sc) / 2;
    }

    handleResize();
    updateColors();

    const CL = E.map((e) => (e.w === null ? 'unknown' : e.w < 2.5 ? 'infeasible' : 'ok'));

    interface Particle {
      s: number;
      w: number;
      e: number;
      d: number;
      t: number;
      n: number;
    }

    const nx = (p: Particle, n: number) => {
      const c = ADJ[n];
      const ne = c[Math.floor(Math.random() * c.length)];
      p.e = ne;
      p.d = E[ne].a === n ? 1 : -1;
      p.t = p.d > 0 ? 0 : 1;
      p.n = n;
      if (CL[ne] === 'infeasible') p.w = 120;
    };

    const PT: Particle[] = Array.from({ length: 28 }, () => {
      const p: Particle = {
        s: 0.0025 + Math.random() * 0.003,
        w: 0,
        e: 0,
        d: 1,
        t: Math.random(),
        n: 0,
      };
      nx(p, Math.floor(Math.random() * 15));
      p.t = Math.random();
      return p;
    });

    const X = (n: number) => ox + mx + N[n].x * sc;
    const Y = (n: number) => oy + my + N[n].y * sc;

    let animId: number;

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';

      // Draw road segments
      E.forEach((e, i) => {
        ctx.strokeStyle = K.ink;
        ctx.globalAlpha = CL[i] === 'infeasible' ? 0.2 : 0.08;
        ctx.lineWidth = (CL[i] === 'infeasible' ? 6 : 12) * sc;
        ctx.beginPath();
        ctx.moveTo(X(e.a), Y(e.a));
        ctx.lineTo(X(e.b), Y(e.b));
        ctx.stroke();
      });

      // Draw moving vehicle particles
      PT.forEach((p) => {
        let x: number;
        let y: number;
        if (p.w > 0) {
          p.w--;
          x = X(p.n);
          y = Y(p.n);
          const r = (1 - p.w / 120) * 26 * sc;
          ctx.globalAlpha = 0.5 * (p.w / 120);
          ctx.strokeStyle = K.sig;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 7);
          ctx.stroke();
          if (!p.w) {
            nx(p, p.n);
          }
        } else {
          const e = E[p.e];
          p.t += p.d * p.s;
          if (p.t >= 1 || p.t <= 0) {
            nx(p, p.d > 0 ? e.b : e.a);
            return;
          }
          x = X(e.a) + (X(e.b) - X(e.a)) * p.t;
          y = Y(e.a) + (Y(e.b) - Y(e.a)) * p.t;
        }

        ctx.globalAlpha = 0.85;
        ctx.fillStyle = p.w > 0 ? K.sig : K.tape;
        ctx.strokeStyle = K.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * Math.max(sc, 0.8), 0, 7);
        ctx.fill();
        ctx.stroke();
      });

      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        animId = requestAnimationFrame(tick);
      }
    };

    const handlePointerMove = (e: MouseEvent) => {
      mx = (e.clientX / W - 0.5) * -18;
      my = (e.clientY / H - 0.5) * -18;
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', handlePointerMove);
    animId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      cancelAnimationFrame(animId);
    };
  }, [theme]);

  return <canvas id="bg" ref={canvasRef} aria-hidden="true" />;
};
