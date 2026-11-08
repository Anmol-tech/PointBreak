import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { interpolate, Sequence, staticFile, useVideoConfig } from "remotion";
import { Card } from "./Card";
import { Shot } from "./Shot";
import {
  FADE_FRAMES,
  frames,
  SECONDS,
  totalFrames,
  VOICE_DELAY,
} from "./timeline";

// Footage in public/footage comes from scripts/record.mjs (the real app, recorded in Chrome); footageStart
// values line up with the moments it logged in public/footage/marks.json. The voiceover comes from
// scripts/voice.mjs (macOS speech), and each scene is at least as long as its line (see timeline.ts).

export const DemoVideo = () => {
  const { fps } = useVideoConfig();
  const end = totalFrames(fps);
  const fadeIn = (
    <TransitionSeries.Transition
      presentation={fade()}
      timing={linearTiming({ durationInFrames: FADE_FRAMES })}
    />
  );
  return (
    <>
      <TransitionSeries name="Scenes">
        <TransitionSeries.Sequence
          name="Title"
          durationInFrames={frames(SECONDS.title, fps)}
        >
          <Card
            name="Title card"
            kicker="TEAM POINTBREAK · AWS × A10 HACK"
            headline="VendorVault"
            sub="Identity, tool permissions and a stop button for every AI agent your vendors bring."
            footer="Track 1 · Agentic Identity"
          />
          <Sequence
            name="Title voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/title.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Problem"
          durationInFrames={frames(SECONDS.problem, fps)}
        >
          <Card
            name="Problem card"
            kicker="THE PROBLEM"
            headline="Vendors' AI agents want your data."
            sub="One shared API key can't tell which agent is asking, can't limit its tools, and can't stop one agent mid-task."
            footer=""
          />
          <Sequence
            name="Problem voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/problem.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Sign-in screen"
          durationInFrames={frames(SECONDS.signin, fps)}
        >
          <Shot
            name="Falcon sign-in"
            file="signin.png"
            footageStart={0}
            step="1 · Enterprise login"
            caption="Falcon's admins sign in with their company login."
            zoomX={50}
            zoomY={42}
            zoomScale={1.9}
            moveToX={50}
            moveToY={36}
            zoomAt={0.3}
          />
          <Sequence
            name="Sign-in screen voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/signin.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Cognito login"
          durationInFrames={frames(SECONDS.cognito, fps)}
        >
          <Shot
            name="Cognito hosted login"
            file="cognito-form.png"
            footageStart={0}
            step="1 · Enterprise login"
            caption="Real Amazon Cognito: OpenID Connect with PKCE."
            zoomX={50}
            zoomY={40}
            zoomScale={1.08}
            moveToX={50}
            moveToY={40}
            zoomAt={0.3}
          />
          <Sequence
            name="Cognito login voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/cognito.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Lead agent"
          durationInFrames={frames(SECONDS.lead, fps)}
        >
          <Shot
            name="Lead agent gets a badge"
            file="team.mp4"
            footageStart={4.0}
            step="2 · Agent identity"
            caption="A Claude agent on Bedrock gets a badge tied to its own key."
            zoomX={50}
            zoomY={50}
            zoomScale={1}
            moveToX={50}
            moveToY={50}
            zoomAt={0}
          />
          <Sequence
            name="Lead agent voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/lead.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Helpers"
          durationInFrames={frames(SECONDS.helpers, fps)}
        >
          <Shot
            name="Helpers get narrower badges"
            file="team.mp4"
            footageStart={6.4}
            step="3 · Agents create agents"
            caption="Two helpers, each with its own key and less access."
            zoomX={7.6}
            zoomY={58}
            zoomScale={1.9}
            moveToX={26}
            moveToY={40}
            zoomAt={0.6}
          />
          <Sequence
            name="Helpers voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/helpers.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Stop"
          durationInFrames={frames(SECONDS.stop, fps)}
        >
          <Shot
            name="Falcon presses Stop"
            file="team.mp4"
            footageStart={12.0}
            step="4 · Revoke mid-task"
            caption="Falcon presses Stop while contracts-reviewer is working."
            zoomX={7.6}
            zoomY={54}
            zoomScale={2.2}
            moveToX={26}
            moveToY={38}
            zoomAt={0.2}
          />
          <Sequence
            name="Stop voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/stop.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Blocked"
          durationInFrames={frames(SECONDS.blocked, fps)}
        >
          <Shot
            name="Next request blocked"
            file="team.mp4"
            footageStart={14.2}
            step="5 · Next request blocked"
            caption="Its next call is refused. The other helper keeps going."
            zoomX={7.6}
            zoomY={66}
            zoomScale={2}
            moveToX={28}
            moveToY={40}
            zoomAt={0.2}
          />
          <Sequence
            name="Blocked voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/blocked.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Memo"
          durationInFrames={frames(SECONDS.memo, fps)}
        >
          <Shot
            name="Memo admits the gap"
            file="team.mp4"
            footageStart={30.0}
            step="Multi-agent result"
            caption="The lead's memo says plainly what is missing."
            zoomX={7.6}
            zoomY={70}
            zoomScale={2}
            moveToX={28}
            moveToY={40}
            zoomAt={0.3}
          />
          <Sequence
            name="Memo voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/memo.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Tools"
          durationInFrames={frames(SECONDS.tools, fps)}
        >
          <Shot
            name="Allowed MCP tools"
            file="tools.mp4"
            footageStart={2.9}
            step="6 · Selected MCP tools"
            caption="Falcon picks which MCP tools each vendor may call."
            zoomX={90}
            zoomY={74}
            zoomScale={1.8}
            moveToX={68}
            moveToY={40}
            zoomAt={0.4}
          />
          <Sequence
            name="Tools voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/tools.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Stolen"
          durationInFrames={frames(SECONDS.stolen, fps)}
        >
          <Shot
            name="Stolen credentials fail"
            file="stolen.mp4"
            footageStart={2.2}
            step="7 · Stolen credentials"
            caption="A copied badge is useless without the agent's key: 3 of 3 attacks blocked."
            zoomX={90}
            zoomY={14}
            zoomScale={1}
            moveToX={90}
            moveToY={14}
            zoomAt={0}
          />
          <Sequence
            name="Stolen voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/stolen.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Trace"
          durationInFrames={frames(SECONDS.trace, fps)}
        >
          <Shot
            name="Trace a leak"
            file="trace.mp4"
            footageStart={1.2}
            step="8 · Trace a leak"
            caption="Leaked text points back to the exact agent and person."
            zoomX={36}
            zoomY={62}
            zoomScale={1.5}
            moveToX={45}
            moveToY={42}
            zoomAt={2}
          />
          <Sequence
            name="Trace voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/trace.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Vendor portal"
          durationInFrames={frames(SECONDS.portal, fps)}
        >
          <Shot
            name="Vendor portal"
            file="portal.mp4"
            footageStart={1.8}
            step="9 · The vendor's side"
            caption="Vendors get short, masked answers. Files never leave."
            zoomX={43}
            zoomY={75}
            zoomScale={1.5}
            moveToX={50}
            moveToY={45}
            zoomAt={1.2}
          />
          <Sequence
            name="Vendor portal voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/portal.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
        {fadeIn}
        <TransitionSeries.Sequence
          name="Outro"
          durationInFrames={frames(SECONDS.outro, fps)}
        >
          <Card
            name="Closing card"
            kicker="VENDORVAULT"
            headline="Know which agent is asking. Stop it anytime."
            sub="Amazon Cognito · Amazon Bedrock · MCP · OAuth token exchange · DPoP · ID-JAG"
            footer="Team PointBreak"
          />
          <Sequence
            name="Outro voice"
            from={Math.round(VOICE_DELAY * fps)}
            layout="none"
          >
            <Audio src={staticFile("voice/outro.mp3")} />
          </Sequence>
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Audio
        name="Music"
        src={staticFile("music/bed.mp3")}
        durationInFrames={end}
        volume={(f) =>
          interpolate(f, [0, 1 * fps, end - 3 * fps, end], [0, 0.8, 0.8, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
    </>
  );
};
