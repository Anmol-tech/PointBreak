import { loadFont } from "@remotion/google-fonts/Inter";
import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const { fontFamily } = loadFont("normal", { weights: ["400", "600", "800"], subsets: ["latin"] });

type CardProps = {
  readonly kicker: string;
  readonly headline: string;
  readonly sub: string;
  readonly footer: string;
};

const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

/** A full-screen title card: what the viewer should read, and nothing else. */
const CardInner = ({ kicker, headline, sub, footer }: CardProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 160px",
        fontFamily,
        color: "white",
        background: "radial-gradient(1200px 700px at 75% 30%, #1d3a8a 0%, #0b1226 55%, #070b17 100%)",
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: 6,
          color: "#7dd3fc",
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], ease),
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          fontSize: 124,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: -3,
          marginTop: 28,
          maxWidth: 1500,
          opacity: interpolate(frame, [0.15 * fps, 0.9 * fps], [0, 1], ease),
          translate: interpolate(frame, [0.15 * fps, 0.9 * fps], ["0px 40px", "0px 0px"], ease),
        }}
      >
        {headline}
      </div>
      <div
        style={{
          fontSize: 56,
          fontWeight: 400,
          lineHeight: 1.3,
          marginTop: 36,
          maxWidth: 1450,
          color: "#cbd5e1",
          opacity: interpolate(frame, [0.5 * fps, 1.3 * fps], [0, 1], ease),
        }}
      >
        {sub}
      </div>
      {footer ? (
        <div
          style={{
            position: "absolute",
            left: 160,
            bottom: 110,
            fontSize: 34,
            color: "#94a3b8",
            opacity: interpolate(frame, [0.9 * fps, 1.6 * fps], [0, 1], ease),
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
};

export const Card = Interactive.create({
  Component: CardInner,
  layout: "absolute-fill",
  schema: {
    kicker: { type: "string", default: "", description: "Small label above the headline" },
    headline: { type: "string", default: "", description: "Headline" },
    sub: { type: "string", default: "", description: "Supporting line" },
    footer: { type: "string", default: "", description: "Footer line" },
  },
});
