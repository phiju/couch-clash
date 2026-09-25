/**
 * Real German traffic signs (public/signs/<VzKat number>.svg) on a white
 * card like on a pole: main sign first, Zusatzzeichen stacked below.
 */
import { isExtraSign } from "./scene-layout";

export function SignStack({ signs, variant = "tv" }: { signs: readonly string[]; variant?: "tv" | "phone" }) {
  const tv = variant === "tv";
  return (
    <div
      className={`flex flex-col items-center rounded-[1.6rem] border-4 border-brown bg-white shadow-[0_8px_0_var(--color-brown),0_20px_40px_rgb(0_0_0/0.35)] ${
        tv ? "gap-[1.2vh] p-[2.2vh]" : "gap-2 p-3"
      }`}
      role="img"
      aria-label={`Verkehrszeichen ${signs.join(", ")}`}
    >
      {signs.map((sign, i) => (
        // Plain <img>: small vector files, nothing to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${sign}${i}`}
          src={`/signs/${sign}.svg`}
          alt=""
          draggable={false}
          className={`w-auto object-contain ${
            isExtraSign(sign) ? (tv ? "h-[min(13vh,9vw)]" : "h-14") : tv ? "h-[min(34vh,22vw)]" : "h-28"
          }`}
        />
      ))}
      <div className={`rounded-full bg-[#8d8f93] ${tv ? "h-[3vh] w-[0.8vw]" : "h-3 w-2"}`} aria-hidden />
    </div>
  );
}
