import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Polyline, Rect } from 'react-native-svg';

import { colors } from '../theme';

// Frames of one step cycle and the time of a frame
const FRAMES = 16;
const FRAME_TIME = 60;

const WIDTH = 64;
const HEIGHT = 96;
const HIP = { x: 32, y: 58 };
const SHOULDER = { x: 35, y: 32 };
const THIGH = 16;
const SHIN = 16;

const rad = (degrees) => (degrees * Math.PI) / 180;
// end of a limb that hangs at angle degrees from straight down, positive is forward
const limb = (from, length, degrees) => ({
  x: from.x + length * Math.sin(rad(degrees)),
  y: from.y + length * Math.cos(rad(degrees)),
});

// Hip, knee and foot of a leg, phase 0…2π for one step. The knee bends while the leg swings forward.
const leg = (phase) => {
  const thigh = 28 * Math.sin(phase);
  const bend = 45 * Math.max(0, Math.cos(phase));
  const knee = limb(HIP, THIGH, thigh);
  return { knee, foot: limb(knee, SHIN, thigh - bend) };
};

// The hiker of the IndiaNavi logo with backpack, hat and stick, walking on the spot. Drawn in the colors of the
// display with black outlines, the feet touch the bottom edge.
export default function Walker({ size = 72, style }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES), FRAME_TIME);
    return () => clearInterval(timer);
  }, []);

  const phase = (frame / FRAMES) * 2 * Math.PI;
  const front = leg(phase);
  const back = leg(phase + Math.PI);
  // the lower foot stays on the ground, the body goes up and down with the steps
  const lift = HEIGHT - 4 - Math.max(front.foot.y, back.foot.y);

  // the arm with the stick swings against the front leg
  const elbow = limb(SHOULDER, 12, 25 - 18 * Math.sin(phase));
  const hand = { x: elbow.x + 8, y: elbow.y - 3 };
  // the stick reaches down to the ground
  const stickFoot = { x: hand.x + 3 - 6 * Math.sin(phase), y: HEIGHT - 3 - lift };

  const drawLeg = ({ knee, foot }) => (
    <>
      <Polyline
        points={`${HIP.x},${HIP.y} ${knee.x},${knee.y} ${foot.x},${foot.y}`}
        fill="none"
        stroke={colors.ink}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Ellipse cx={foot.x + 3} cy={foot.y + 1} rx={5} ry={3} fill={colors.blue} stroke={colors.ink} strokeWidth={1.5} />
    </>
  );

  return (
    <View style={style} accessibilityRole="image" accessibilityLabel="Loading">
      <Svg width={walkerWidth(size)} height={size} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <G transform={`translate(0, ${lift})`}>
          {drawLeg(back)}
          {/* backpack */}
          <Rect x={20} y={24} width={15} height={26} rx={6} fill={colors.green} stroke={colors.ink} strokeWidth={2} />
          <Rect x={22} y={36} width={8} height={10} rx={2} fill={colors.green} stroke={colors.ink} strokeWidth={1.5} />
          {/* body */}
          <Line x1={HIP.x} y1={HIP.y} x2={SHOULDER.x + 2} y2={SHOULDER.y - 6} stroke={colors.ink} strokeWidth={4} strokeLinecap="round" />
          {drawLeg(front)}
          {/* head and hat */}
          <Circle cx={40} cy={18} r={7} fill={colors.paper} stroke={colors.ink} strokeWidth={2} />
          <Rect x={34} y={6} width={13} height={6} rx={2} fill={colors.orange} stroke={colors.ink} strokeWidth={1.5} />
          <Rect x={34} y={10} width={13} height={2} fill={colors.red} />
          <Line x1={30} y1={12.5} x2={51} y2={11} stroke={colors.ink} strokeWidth={2.5} strokeLinecap="round" />
          {/* stick and the arm that holds it */}
          <Line x1={hand.x - 1} y1={hand.y - 10} x2={stickFoot.x} y2={stickFoot.y} stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
          <Polyline
            points={`${SHOULDER.x},${SHOULDER.y} ${elbow.x},${elbow.y} ${hand.x},${hand.y}`}
            fill="none"
            stroke={colors.ink}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </G>
      </Svg>
    </View>
  );
}

export const walkerWidth = (size = 72) => (size * WIDTH) / HEIGHT;
