import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme
} from '@fluentui/react-components'

const brand: BrandVariants = {
  10: '#170C08',
  20: '#2A130C',
  30: '#441C10',
  40: '#5E2616',
  50: '#78321E',
  60: '#924027',
  70: '#AD4F30',
  80: '#D65F35',
  90: '#E4774F',
  100: '#EC906D',
  110: '#F2A98C',
  120: '#F7C1AB',
  130: '#FAD7C9',
  140: '#FCE8E0',
  150: '#FEF4F0',
  160: '#FFF9F7'
}

export const darkTheme: Theme = {
  ...createDarkTheme(brand),
  colorNeutralBackground1: '#111714',
  colorNeutralBackground2: '#171F1B',
  colorNeutralBackground3: '#1D2822',
  colorNeutralBackground4: '#25322B',
  colorNeutralBackground5: '#2B3931',
  colorNeutralBackground6: '#34443A',
  colorNeutralStroke1: '#34453B',
  colorNeutralStroke2: '#29372F',
  colorNeutralForeground1: '#F2F5F3',
  colorNeutralForeground2: '#C8D1CC',
  colorNeutralForeground3: '#98A69F'
}

export const lightTheme: Theme = {
  ...createLightTheme(brand),
  colorNeutralBackground1: '#FAFBFA',
  colorNeutralBackground2: '#F1F4F2',
  colorNeutralBackground3: '#E7ECE9',
  colorNeutralStroke1: '#CDD6D0',
  colorNeutralForeground1: '#17201B',
  colorNeutralForeground2: '#3F4E46',
  colorNeutralForeground3: '#66756D'
}
