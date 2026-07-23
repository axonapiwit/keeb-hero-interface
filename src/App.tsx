import { useEffect, useRef, useState } from 'react';
import { startEngine } from './three/engine';
import type { Engine } from './three/engine';
import { LAYERS } from './content';

/**
 * React owns the DOM shell. It does NOT own anything that changes per frame —
 * the scroll progress bar reads a CSS custom property the render loop writes,
 * and every Object3D transform is mutated directly. Two pieces of state exist,
 * and each flips at most once: `ready` and `error`.
 */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine | null = null;
    let cancelled = false;

    startEngine({
      canvas,
      stages: LAYERS.length, // one scroll hold per layer section
      onReady: () => !cancelled && setReady(true),
    })
      .then((e) => {
        // StrictMode runs the effect twice; if cleanup already fired while the
        // .glb was loading, tear the second engine down immediately.
        if (cancelled) e.dispose();
        else engine = e;
      })
      .catch((err: unknown) => {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        console.error('[keeb-hero]', err);
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      engine?.dispose();
      engine = null;
    };
  }, []);

  return (
    <>
      <canvas id="app" ref={canvasRef} />

      {!ready && (
        <div className="boot" {...(error ? { 'data-error': '' } : {})}>
          {error ?? 'loading'}
        </div>
      )}

      <nav>
        <span className="mark">SEVENTY-FIVE</span>
        <ul>
          <li>
            <a href="#layers">Layers</a>
          </li>
          <li>
            <a href="#specs">Specs</a>
          </li>
          <li>
            <a href="#">Buy</a>
          </li>
        </ul>
        <span style={{ opacity: 0.62 }}>press D</span>
      </nav>

      <main>
        <section className="hero">
          <h1>
            Eighty&#8209;four
            <br />
            keys.
            <br />
            <em>One</em> stack.
          </h1>
          <p className="sub">
            A 75% high-profile board, taken apart and put back together while you scroll.
          </p>
          <div className="meta">
            <span>
              Keys<b>84</b>
            </span>
            <span>
              Layers<b>13</b>
            </span>
            <span>
              Profile<b>High</b>
            </span>
          </div>
        </section>

        {LAYERS.map((l) => (
          <section className="layer" key={l.idx} id={l.anchor}>
            <span className="idx">{l.idx}</span>
            <h2>{l.title}</h2>
            <p>{l.body}</p>
          </section>
        ))}

        <section className="hero">
          <h1>
            Back
            <br />
            <em>together</em>.
          </h1>
          <p className="sub">Scroll up and it reassembles. Click anywhere to press a row.</p>
        </section>
      </main>

      <div className="bar" />
      <div className="hint">scroll to disassemble</div>
    </>
  );
}
