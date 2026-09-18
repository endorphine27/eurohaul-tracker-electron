// Aceleasi presetari ca in versiunea anterioara (Python) -- se aplica DOAR
// pe fundalul benzii de informatii, nu pe fereastra principala.
const ACCENT_PRESETS = {
  classic: { base: '#0d1119', bright: '#8b93a7', label: 'Clasic (bara actuală, întunecată)' },
  gold: { base: '#d4a94a', bright: '#f0c674', label: 'Auriu (EuroHaul)' },
  trucky: { base: '#d4457a', bright: '#f06a9a', label: 'Trucky (roz)' },
  teal: { base: '#3ea6a0', bright: '#5fc9c2', label: 'Turcoaz' },
  blue: { base: '#4a7fc9', bright: '#6a9de0', label: 'Albastru' },
};

const POSITIONS = [
  { key: 'top_h', label: 'Sus (orizontal)' },
  { key: 'bottom_h', label: 'Jos (orizontal)' },
  { key: 'left_v', label: 'Stânga (vertical)' },
  { key: 'right_v', label: 'Dreapta (vertical)' },
];

module.exports = { ACCENT_PRESETS, POSITIONS };
