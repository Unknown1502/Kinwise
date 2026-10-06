import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {forceScreenReader} from '../../tv-app/src/a11y/screenReader';
import {App} from '../../tv-app/src/App';
import {getConfig, setConfig} from '../../tv-app/src/config';
import {configureWebRemote} from './remote';

/*
 * Browser preview of the Fire TV app. The app (packages/tv-app/src) renders into a real
 * 1920×1080 canvas through react-native-web, scaled to fit the window like a TV would.
 * URL options: ?hub=http://host:8787  ?token=dev-tv  ?voiceview=1  ?guides=1
 * (react-native-web reports a screen reader as on, so focus moves are "spoken" in the bottom bar.)
 */
const params = new URLSearchParams(window.location.search);
const hub = params.get('hub');
const token = params.get('token');
setConfig({...(hub ? {hubUrl: hub} : {}), ...(token ? {deviceToken: token} : {})});
if (params.get('voiceview') === '1') forceScreenReader(true);
configureWebRemote();

const TV_W = 1920;
const TV_H = 1080;
const BEZEL = 20;

function Preview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [said, setSaid] = useState('');
  const [guides, setGuides] = useState(params.get('guides') === '1');

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const fit = () => {
      const {width, height} = stage.getBoundingClientRect();
      const next = Math.min((width - BEZEL) / TV_W, (height - BEZEL) / TV_H);
      setScale(Math.max(0.1, Math.min(1, next)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onAnnounce = (e: Event) => setSaid(String((e as CustomEvent<string>).detail ?? ''));
    window.addEventListener('kinwise:announce', onAnnounce);
    return () => window.removeEventListener('kinwise:announce', onAnnounce);
  }, []);

  return (
    <div className="preview">
      <div className="preview-bar">
        <span>
          <strong>Fire TV app preview (react-native-web)</strong> — the real app runs on Vega OS
        </span>
        <span className="preview-keys" aria-hidden="true">
          <kbd>←</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <kbd>→</kbd> move · <kbd>Enter</kbd> select · <kbd>Esc</kbd> back
        </span>
        <span>
          hub {getConfig().hubUrl}{' '}
          <button
            type="button"
            onClick={(e) => {
              setGuides((g) => !g);
              e.currentTarget.blur();
            }}>
            {guides ? 'hide' : 'show'} 5% safe area
          </button>
        </span>
      </div>
      <div className="preview-stage" ref={stageRef}>
        <div className="tv-bezel">
          <div className="tv-viewport" style={{width: TV_W * scale, height: TV_H * scale}}>
            <div className="tv-canvas" style={{transform: `scale(${scale})`}}>
              <App />
            </div>
            {guides ? <div className="overscan-guide" /> : null}
          </div>
        </div>
      </div>
      <div className="voiceview" aria-hidden="true">
        VoiceView would say: <strong>{said || '—'}</strong>
      </div>
    </div>
  );
}

// No <StrictMode>: react-tv-space-navigation relies on render order (see its pitfalls doc).
createRoot(document.getElementById('root')!).render(<Preview />);
