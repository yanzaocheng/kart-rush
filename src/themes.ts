/** Track layouts + visual themes. */

export interface TrackDef {
  id: string;
  name: string;
  desc: string;
  scale: number;
  control: [number, number][];
  boostPads: [number, number][]; // [meters along track, lateral]
  itemRows: number[]; // meters along track
  theme: Theme;
}

export interface Theme {
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  sunDir: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  exposure: number;
  ground: 'grass' | 'sand';
  shoulder: number;
  barrier: [string, string, string]; // stripe A, stripe B, trim
  flora: 'forest' | 'desert';
  mountains: { low: number; mid: number; peak: number; mesa: boolean };
  banner: [string, string];
  cloudTint: number;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'park',
    name: '阳光公园',
    desc: '绿草与松林环绕的经典赛道，大发夹弯考验漂移。',
    scale: 1.25,
    control: [
      [0, -40], [0, 60], [10, 140], [60, 190], [130, 190], [170, 140], [160, 80], [190, 30],
      [260, 30], [300, 80], [360, 90], [400, 40], [390, -40], [330, -80], [300, -150], [330, -220],
      [290, -280], [200, -280], [140, -250], [100, -190], [50, -190], [0, -260], [-50, -240],
      [-45, -175], [0, -120],
    ],
    boostPads: [[260, -5], [700, 5], [1150, 0], [1640, -5], [1990, 4]],
    itemRows: [120, 560, 1000, 1450, 1880],
    theme: {
      skyTop: 0x2f7fe0, skyMid: 0x8ec9ff, skyHorizon: 0xe6f3ff,
      sunDir: [0.45, 0.75, 0.35], sunColor: 0xfff1dc, sunIntensity: 2.8,
      hemiSky: 0xcfe8ff, hemiGround: 0x5d7a3a, hemiIntensity: 0.9,
      fog: 0xd6ebff, fogNear: 260, fogFar: 1900, exposure: 1.0,
      ground: 'grass', shoulder: 0xd9c08a,
      barrier: ['#1f6fe0', '#ffffff', '#ffcc00'],
      flora: 'forest',
      mountains: { low: 0x4f7d45, mid: 0x7d8a8f, peak: 0xf4f7fb, mesa: false },
      banner: ['#e0262b', '#ffffff'],
      cloudTint: 0xffffff,
    },
  },
  {
    id: 'desert',
    name: '落日沙漠',
    desc: '夕阳峡谷中的高速赛道，连续高速弯与长直道。',
    scale: 1.2,
    control: [
      [0, -40], [0, 80], [30, 150], [100, 170], [160, 130], [150, 60], [200, 10], [280, 20],
      [320, 90], [280, 160], [300, 220], [380, 220], [430, 150], [420, 40], [360, -40], [380, -120],
      [320, -190], [230, -180], [175, -120], [110, -150], [40, -200], [-30, -160], [-20, -100],
    ],
    boostPads: [[300, 4], [820, -4], [1240, 0], [1700, 5], [2080, -3]],
    itemRows: [150, 620, 1080, 1520, 1930],
    theme: {
      skyTop: 0x33447e, skyMid: 0xe98a5c, skyHorizon: 0xffd29a,
      sunDir: [-0.55, 0.28, 0.6], sunColor: 0xffc48a, sunIntensity: 3.2,
      hemiSky: 0xffd9b0, hemiGround: 0x9a5a34, hemiIntensity: 0.85,
      fog: 0xf2bf94, fogNear: 240, fogFar: 1800, exposure: 1.05,
      ground: 'sand', shoulder: 0xc98d5a,
      barrier: ['#d8322b', '#ffffff', '#3a2a1f'],
      flora: 'desert',
      mountains: { low: 0xb5562f, mid: 0xd9814a, peak: 0xf0b27a, mesa: true },
      banner: ['#ff8a1f', '#ffffff'],
      cloudTint: 0xffd9c4,
    },
  },
];
