import { loadFont } from "@remotion/google-fonts/Inter";
import { Video } from "@remotion/media";
import { CanvasImage, Easing, Interactive, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const { fontFamily } = loadFont("normal", { weights: ["400", "600", "800"], subsets: ["latin"] });

type ShotProps = {
  /** File in public/footage: an .mp4 clip or a .png still. */
  readonly file: string;
  /** Seconds into the footage where this shot starts. */
  readonly footageStart: number;
  /** Short step label, e.g. "1 · Authenticate". */
  readonly step: string;
  readonly caption: string;
  /** Zoom target in percent of the frame, and how far to zoom (1 = no zoom). */
  readonly zoomX: number;
  readonly zoomY: number;
  readonly zoomScale: number;
  /** Where the zoom target ends up on screen, in percent (keeps it clear of the caption). */
  readonly moveToX: number;
  readonly moveToY: number;
  /** Seconds into the shot when the zoom starts. */
  readonly zoomAt: number;
};

const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;

/** Recorded app footage (or a still) with one big caption, optionally zooming into the part that matters. */
const ShotInner = ({ file, footageStart, step, caption, zoomX, zoomY, zoomScale, moveToX, moveToY, zoomAt }: ShotProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const src = staticFile(`footage/${file}`);
  // Zoom around the target, then slide it toward moveTo — but never so far that the footage
  // stops covering the frame (that left a dark strip on the left of the zoomed shots).
  const progress = interpolate(frame, [zoomAt * fps, (zoomAt + 0.9) * fps], [0, 1], ease);
  const scale = 1 + (zoomScale - 1) * progress;
  const ox = (zoomX / 100) * width;
  const oy = (zoomY / 100) * height;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const tx = clamp(((moveToX - zoomX) / 100) * width * progress, (width - ox) * (1 - scale), ox * (scale - 1));
  const ty = clamp(((moveToY - zoomY) / 100) * height * progress, (height - oy) * (1 - scale), oy * (scale - 1));
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: `${zoomX}% ${zoomY}%`,
          scale: String(scale),
          translate: `${tx}px ${ty}px`,
        }}
      >
        {file.endsWith(".png") ? (
          <CanvasImage src={src} style={{ width: "100%", height: "100%" }} />
        ) : (
          <Video src={src} muted trimBefore={Math.round(footageStart * fps)} style={{ width: "100%", height: "100%" }} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 420,
          background: "linear-gradient(to top, rgba(4,8,20,0.94) 0%, rgba(4,8,20,0.75) 45%, rgba(4,8,20,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 140,
          right: 140,
          bottom: 100,
          fontFamily,
          color: "white",
          opacity: interpolate(frame, [0.1 * fps, 0.6 * fps], [0, 1], ease),
          translate: interpolate(frame, [0.1 * fps, 0.6 * fps], ["0px 30px", "0px 0px"], ease),
        }}
      >
        <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: 4, color: "#7dd3fc", textTransform: "uppercase" }}>
          {step}
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1, marginTop: 14 }}>{caption}</div>
      </div>
    </>
  );
};

export const Shot = Interactive.create({
  Component: ShotInner,
  layout: "absolute-fill",
  schema: {
    file: { type: "string", default: "team.mp4", description: "Footage file in public/footage" },
    footageStart: { type: "number", default: 0, min: 0, step: 0.1, description: "Footage start (s)", hiddenFromList: false },
    step: { type: "string", default: "", description: "Step label" },
    caption: { type: "string", default: "", description: "Caption" },
    zoomX: { type: "number", default: 50, min: 0, max: 100, description: "Zoom target X (%)", hiddenFromList: false },
    zoomY: { type: "number", default: 50, min: 0, max: 100, description: "Zoom target Y (%)", hiddenFromList: false },
    zoomScale: { type: "number", default: 1, min: 1, max: 4, step: 0.05, description: "Zoom amount", hiddenFromList: false },
    moveToX: { type: "number", default: 50, min: 0, max: 100, description: "Zoom target ends at X (%)", hiddenFromList: false },
    moveToY: { type: "number", default: 50, min: 0, max: 100, description: "Zoom target ends at Y (%)", hiddenFromList: false },
    zoomAt: { type: "number", default: 0.5, min: 0, step: 0.1, description: "Zoom start (s)", hiddenFromList: false },
  },
});
