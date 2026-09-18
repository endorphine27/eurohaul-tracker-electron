const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Cele 4 pozitii posibile (acelasi concept ca in versiunea anterioara):
// sus/jos orizontal (lat cat ecranul), stanga/dreapta vertical (inalt cat
// ecranul). Nu se muta cu mouse-ul -- pozitia se alege doar din Setari.
const VERTICAL_WIDTH = 230;

function computeBounds(position) {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.bounds;
  const vertical = position === 'left_v' || position === 'right_v';

  if (vertical) {
    const x = position === 'left_v' ? 0 : sw - VERTICAL_WIDTH;
    return { x, y: 0, width: VERTICAL_WIDTH, height: sh, vertical: true };
  }
  const height = 46;
  const y = position === 'top_h' ? 0 : sh - height;
  return { x: 0, y, width: sw, height, vertical: false };
}

function createBarWindow(position = 'bottom_h') {
  const bounds = computeBounds(position);

  const barWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'bar', 'bar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  barWindow.setAlwaysOnTop(true, 'screen-saver');
  barWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  barWindow.loadFile(path.join(__dirname, '..', 'renderer', 'bar', 'bar.html'));

  let currentPosition = position;
  let currentStyle = { accentColor: '#0d1119', accentBright: '#8b93a7', fontSize: 13 };

  function sendOrientation() {
    const b = computeBounds(currentPosition);
    barWindow.webContents.send('bar:orientation', b.vertical ? 'vertical' : 'horizontal');
  }

  function sendStyle() {
    barWindow.webContents.send('bar:style', currentStyle);
  }

  function setPosition(newPosition) {
    currentPosition = newPosition;
    const b = computeBounds(newPosition);
    barWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    sendOrientation();
  }

  function setStyle(style) {
    currentStyle = { ...currentStyle, ...style };
    sendStyle();
  }

  barWindow.webContents.once('did-finish-load', () => {
    sendOrientation();
    sendStyle();
  });

  return { window: barWindow, setPosition, setStyle };
}

module.exports = { createBarWindow, VERTICAL_WIDTH };
