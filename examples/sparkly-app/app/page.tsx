"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./page.module.css";

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}

const SPARKLE_COLORS = [
  "#FFD700", // Gold
  "#FF69B4", // Hot Pink
  "#00BFFF", // Deep Sky Blue
  "#FF6347", // Tomato
  "#9370DB", // Medium Purple
  "#00FA9A", // Medium Spring Green
  "#FF1493", // Deep Pink
  "#00CED1", // Dark Turquoise
];

const generateSparkle = (x?: number, y?: number): Sparkle => {
  return {
    id: Math.random(),
    x: x ?? Math.random() * 100,
    y: y ?? Math.random() * 100,
    size: Math.random() * 10 + 5,
    color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
    delay: Math.random() * 0.5,
  };
};

export default function Home() {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [mouseSparkles, setMouseSparkles] = useState<Sparkle[]>([]);

  // Generate initial background sparkles
  useEffect(() => {
    const initialSparkles = Array.from({ length: 50 }, () => generateSparkle());
    setSparkles(initialSparkles);

    // Regenerate sparkles periodically
    const interval = setInterval(() => {
      setSparkles((prev) =>
        prev.map((sparkle) => ({
          ...sparkle,
          id: Math.random(),
          delay: Math.random() * 0.5,
        }))
      );
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Handle mouse movement to create sparkle trail
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      const newSparkle = generateSparkle(x, y);
      setMouseSparkles((prev) => [...prev.slice(-20), newSparkle]);
    },
    []
  );

  // Clean up old mouse sparkles
  useEffect(() => {
    const cleanup = setInterval(() => {
      setMouseSparkles((prev) => prev.slice(-10));
    }, 500);

    return () => clearInterval(cleanup);
  }, []);

  return (
    <main className={styles.main} onMouseMove={handleMouseMove}>
      <div className={styles.content}>
        <h1 className={styles.title}>
          <span className={styles.sparkleText}>Sparkly</span> App
        </h1>
        <p className={styles.description}>
          Move your mouse around to create sparkles!
        </p>
        <div className={styles.card}>
          <h2>Welcome to the Sparkle Zone</h2>
          <p>
            This is a magical Next.js application filled with sparkles and
            wonder. Every movement creates a trail of stardust.
          </p>
        </div>
      </div>

      {/* Background sparkles */}
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className={styles.sparkle}
          style={{
            left: `${sparkle.x}%`,
            top: `${sparkle.y}%`,
            width: sparkle.size,
            height: sparkle.size,
            backgroundColor: sparkle.color,
            animationDelay: `${sparkle.delay}s`,
          }}
        />
      ))}

      {/* Mouse trail sparkles */}
      {mouseSparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          className={styles.mouseSparkle}
          style={{
            left: `${sparkle.x}%`,
            top: `${sparkle.y}%`,
            width: sparkle.size * 1.5,
            height: sparkle.size * 1.5,
            backgroundColor: sparkle.color,
          }}
        />
      ))}
    </main>
  );
}
