import { Composition } from "remotion";
import { DemoVideo } from "./DemoVideo";
import { totalFrames } from "./timeline";

// Scene lengths follow the voiceover (src/voice.json); the total is the scenes minus the fades.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VendorVaultDemo"
        component={DemoVideo}
        durationInFrames={totalFrames(30)}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
