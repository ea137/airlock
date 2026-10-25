<!-- Nothing moves unless motion is allowed
     (the theme's switch, and the phone not asking for less motion), and
     nothing runs while the page is hidden or the secret game covers it. -->
<script lang="ts">
  import { gameDoor } from '../features/game/door.svelte';
  import { look, motionAllowed } from './theme.svelte';

  const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789Z:=*+<>';
  const CELL = 16;
  /** Frames per second: rain is slow, and the phone's battery matters. */
  const FPS = 20;

  let canvas: HTMLCanvasElement | undefined = $state();

  const scanlines = $derived(['hacker', 'vector', 'teletext'].includes(look.theme));

  $effect(() => {
    if (look.theme !== 'matrix' || !canvas) return;
    const moving = motionAllowed();
    const context = canvas.getContext('2d');
    if (!context) return;
    const target = canvas;
    const colour = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim();
    let drops: number[] = [];
    const size = () => {
      const ratio = window.devicePixelRatio || 1;
      target.width = window.innerWidth * ratio;
      target.height = window.innerHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `${CELL - 2}px ui-monospace, monospace`;
      drops = Array.from({ length: Math.ceil(window.innerWidth / CELL) }, () =>
        Math.floor((Math.random() * window.innerHeight) / CELL),
      );
    };
    const step = () => {
      context.fillStyle = 'rgba(0, 0, 0, 0.12)';
      context.fillRect(0, 0, window.innerWidth, window.innerHeight);
      context.fillStyle = colour;
      drops.forEach((row, column) => {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '0';
        context.fillText(glyph, column * CELL, row * CELL);
        drops[column] = row * CELL > window.innerHeight && Math.random() > 0.975 ? 0 : row + 1;
      });
    };
    size();
    // Still: a few rows drawn once. Moving: a slow rain.
    for (let i = 0; i < 40; i += 1) step();
    if (!moving || gameDoor.open) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < 1000 / FPS) return;
      last = now;
      step();
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', size);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', size);
    };
  });
</script>

{#if look.theme === 'matrix'}
  <canvas bind:this={canvas} class="rain" aria-hidden="true"></canvas>
{/if}
{#if scanlines}
  <div class="scan" class:scan--flicker={look.theme === 'hacker' && look.motion} aria-hidden="true"></div>
{/if}

<style>
  .rain {
    position: fixed;
    inset: 0;
    /* Behind the screens: #app makes the stacking context. */
    z-index: -1;
    width: 100%;
    height: 100%;
    opacity: 0.45;
    pointer-events: none;
  }
  .scan {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(180deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px),
      radial-gradient(ellipse at center, transparent 55%, rgb(0 0 0 / 0.5) 100%);
  }
  .scan--flicker {
    animation: flicker 6s steps(1) infinite;
  }
  @keyframes flicker {
    0%,
    97%,
    100% {
      opacity: 1;
    }
    98% {
      opacity: 0.6;
    }
  }
</style>
