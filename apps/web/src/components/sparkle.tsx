/** A few ✨ bursting around an avatar (photo avatar ready). Place inside a `relative` box. */
export function Sparkle() {
  const spots = [
    ["-6%", "8%", "2.2rem", "0s"],
    ["82%", "0%", "1.8rem", "0.15s"],
    ["90%", "62%", "2.4rem", "0.3s"],
    ["-2%", "70%", "1.6rem", "0.45s"],
    ["44%", "-14%", "2rem", "0.2s"],
  ] as const;
  return (
    <span className="sparkle" aria-hidden>
      {spots.map(([left, top, size, delay]) => (
        <span key={`${left}${top}`} style={{ left, top, fontSize: size, animationDelay: delay }}>
          ✨
        </span>
      ))}
    </span>
  );
}
