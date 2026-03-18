"use client";
import React, { useState, useEffect, useMemo, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// MATH
// ═══════════════════════════════════════════════════════════════════════════════

const calcEMA = (c, p) => {
  if (c.length < p) return null;
  const k = 2 / (p + 1);
  let v = c.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < c.length; i++) v = c[i] * k + v * (1 - k);
  return v;
};

// Wilder's RSI — matches TradingView exactly
const calcRSI = (c, p = 14) => {
  if (c.length < p * 2) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= p; i++) {
    const d = c[i] - c[i - 1];
    d > 0 ? (ag += d) : (al -= d);
  }
  ag /= p; al /= p;
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
};

// Average True Range (volatility)
const calcATR = (highs, lows, closes, p = 14) => {
  if (closes.length < p + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  let atr = trs.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < trs.length; i++) atr = (atr * (p - 1) + trs[i]) / p;
  return atr;
};

// Momentum score 0–100: composite of RSI position, EMA stack, price vs EMAs
const calcMomentum = (price, e55, e90, e200, rsi) => {
  let score = 0;
  // RSI component (0-30)
  if (rsi !== null) score += Math.min(30, Math.max(0, (rsi / 100) * 30));
  // EMA stack alignment (0-30)
  if (e55 && e90 && e200) {
    if (e55 > e90 && e90 > e200) score += 30;
    else if (e55 > e200) score += 15;
  }
  // Price vs EMAs (0-40)
  let emaScore = 0;
  if (e55  && price > e55)  emaScore += 13;
  if (e90  && price > e90)  emaScore += 13;
  if (e200 && price > e200) emaScore += 14;
  score += emaScore;
  return Math.round(Math.min(100, score));
};

// Detect recent EMA55/90 crossover (within last 5 candles)
const detectCross = (closes) => {
  if (closes.length < 95) return null;
  const recent = 5;
  const crossovers = [];
  for (let i = closes.length - recent; i < closes.length - 1; i++) {
    const slice = closes.slice(0, i + 1);
    const e55a = calcEMA(slice, 55), e90a = calcEMA(slice, 90);
    const sliceNext = closes.slice(0, i + 2);
    const e55b = calcEMA(sliceNext, 55), e90b = calcEMA(sliceNext, 90);
    if (!e55a || !e90a || !e55b || !e90b) continue;
    if (e55a < e90a && e55b > e90b) crossovers.push('GOLDEN');
    if (e55a > e90a && e55b < e90b) crossovers.push('DEATH');
  }
  return crossovers[crossovers.length - 1] || null;
};

const pct = (price, base) => base && base > 0 ? ((price - base) / base) * 100 : null;

const fmt = (p) => {
  if (!p && p !== 0) return '—';
  if (p === 0) return '0';
  if (Math.abs(p) < 0.00001) return p.toExponential(2);
  if (Math.abs(p) < 0.001)   return p.toFixed(6);
  if (Math.abs(p) < 0.1)     return p.toFixed(5);
  if (Math.abs(p) < 1)       return p.toFixed(4);
  if (Math.abs(p) < 100)     return p.toFixed(3);
  if (Math.abs(p) < 10000)   return p.toFixed(2);
  return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

// ═══════════════════════════════════════════════════════════════════════════════
// ZONE
// ═══════════════════════════════════════════════════════════════════════════════

const getZone = (price, e55, e90, e200) => {
  const a55 = e55 !== null && price > e55;
  const a90 = e90 !== null && price > e90;
  const a200 = e200 !== null && price > e200;
  const stacked = e55 && e90 && e200 && e55 > e90 && e90 > e200;
  if (a55 && a90 && a200 && stacked)       return 'FULL_BULL';
  if (a55 && a90 && a200)                  return 'ABOVE_ALL';
  if (!a55 && a90 && a200)                 return 'COILING';
  if (a55 && a90 && !a200)                 return 'RECOVERY';
  if (!a55 && !a90 && a200)                return 'BREAKDOWN';
  if (e200 === null)                       return 'NEW_COIN';
  if (!a55 && !a90 && !a200 && e55 && e55 > e200) return 'BEAR_WATCH';
  return 'BEAR_FULL';
};

const Z = {
  FULL_BULL:  { label:'FULL BULL',  color:'#C8FF25', dim:'rgba(200,255,37,0.05)',  glow:'none' },
  ABOVE_ALL:  { label:'ABOVE ALL',  color:'#7FFF54', dim:'rgba(127,255,84,0.04)',  glow:'none' },
  COILING:    { label:'COILING',    color:'#FFD93D', dim:'rgba(255,217,61,0.04)',  glow:'none' },
  RECOVERY:   { label:'RECOVERY',   color:'#FF9A3C', dim:'rgba(255,154,60,0.04)',  glow:'none' },
  BREAKDOWN:  { label:'BREAKDOWN',  color:'#FF4F4F', dim:'rgba(255,79,79,0.04)',   glow:'none' },
  BEAR_WATCH: { label:'BEAR WATCH', color:'#CC2929', dim:'rgba(204,41,41,0.04)',   glow:'none' },
  BEAR_FULL:  { label:'BEAR FULL',  color:'#880E0E', dim:'rgba(136,14,14,0.04)',   glow:'none' },
  NEW_COIN:   { label:'NEW COIN',   color:'#555577', dim:'rgba(85,85,119,0.03)',   glow:'none' },
};
const ZK = Object.keys(Z);

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════════════════════

const PINNED = ['INJUSDT','SUIUSDT','APTUSDT','TIAUSDT','SOLUSDT','ETHUSDT','BTCUSDT'];

const fetchAllKlines = async (symbols, onProgress) => {
  let done = 0;
  const results = await Promise.allSettled(
    symbols.map(sym =>
      fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=250`)
        .then(r => r.json())
        .then(raw => {
          onProgress(++done);
          if (!Array.isArray(raw) || raw.length < 30) return null;
          const closes  = raw.map(k => parseFloat(k[4]));
          const highs   = raw.map(k => parseFloat(k[2]));
          const lows    = raw.map(k => parseFloat(k[3]));
          const e55  = calcEMA(closes, 55);
          const e90  = calcEMA(closes, 90);
          const e200 = calcEMA(closes, 200);
          const rsiVal = calcRSI(closes);
          const price  = closes[closes.length - 1];
          return {
            sym, e55, e90, e200,
            rsi:        rsiVal,
            atr:        calcATR(highs, lows, closes),
            momentum:   calcMomentum(price, e55, e90, e200, rsiVal),
            cross:      detectCross(closes),
            // 7-day close sparkline
            spark:      closes.slice(-8),
            // Recent high/low for context
            high30:     Math.max(...closes.slice(-30)),
            low30:      Math.min(...closes.slice(-30)),
          };
        })
        .catch(() => { onProgress(++done); return null; })
    )
  );
  return results.reduce((acc, r) => {
    if (r.status === 'fulfilled' && r.value) acc[r.value.sym] = r.value;
    return acc;
  }, {});
};

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// Inline sparkline SVG
const Spark = ({ data, color }) => {
  if (!data || data.length < 2) return null;
  const W = 64, H = 24;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');
  const up = data[data.length-1] >= data[0];
  return (
    <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
      <polyline points={pts} fill="none" stroke={up ? '#C8FF25' : '#FF4F4F'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
};

// Momentum score bar
const MomentumBar = ({ score }) => {
  const col = score >= 70 ? '#C8FF25' : score >= 45 ? '#FFD93D' : score >= 25 ? '#FF9A3C' : '#FF4F4F';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
      <div style={{ flex:1, height:'3px', background:'rgba(255,255,255,0.06)', position:'relative' }}>
        <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${score}%`, background:col, transition:'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily:'monospace', fontSize:'13px', fontWeight:700, color:col, minWidth:'28px', textAlign:'right' }}>{score}</span>
    </div>
  );
};

// EMA row
const EmaRow = ({ label, val, price, color }) => {
  if (val === null) return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'3px 0' }}>
      <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.5)', letterSpacing:'0.08em' }}>{label}</span>
      <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>—</span>
    </div>
  );
  const p = pct(price, val);
  const above = price > val;
  const fill = Math.min(100, Math.max(0, ((p + 50) / 100) * 100));
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'3px' }}>
        <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.6)', letterSpacing:'0.08em', fontWeight:500 }}>{label}</span>
        <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
          <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>${fmt(val)}</span>
          <span style={{ fontFamily:'monospace', fontSize:'11px', fontWeight:700, color: above ? color : '#FF4F4F', minWidth:'52px', textAlign:'right' }}>
            {above?'+':''}{p !== null ? p.toFixed(1) : '—'}%
          </span>
        </div>
      </div>
      <div style={{ height:'2px', background:'rgba(255,255,255,0.06)', position:'relative', marginBottom:'1px' }}>
        <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${fill}%`, background: above ? color : '#FF4F4F', opacity:0.5 }} />
        <div style={{ position:'absolute', left:'50%', top:'-1px', width:'1px', height:'4px', background:'rgba(255,255,255,0.1)' }} />
      </div>
    </div>
  );
};

// Alpha signal tags
const SignalTag = ({ label, color, bg }) => (
  <span style={{
    fontFamily:'monospace', fontSize:'10px', fontWeight:700,
    letterSpacing:'0.1em', padding:'2px 6px',
    color, background: bg || color+'18',
    border:`1px solid ${color}44`,
    whiteSpace:'nowrap',
  }}>{label}</span>
);


// ═══════════════════════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════════

// Plain-English explanations per zone
const ZONE_EXPLAIN = {
  FULL_BULL:  { verdict:"Above all EMAs, stacked right. Trend is clean.",             watch:"Dips to EMA 55 are the entry.",                              color:'#C8FF25' },
  ABOVE_ALL:  { verdict:"Above all EMAs but not fully stacked yet.",                  watch:"Wait for 55 > 90 > 200 alignment before sizing in.",         color:'#7FFF54' },
  COILING:    { verdict:"Above 200, lost the 55 and 90. Compressing.",                watch:"Reclaim 55 = next leg up. Lose 200 = bail.",                 color:'#FFD93D' },
  RECOVERY:   { verdict:"Reclaimed 55 and 90 but 200 is still overhead.",             watch:"EMA 200 is the wall. Break it or this stalls.",              color:'#FF9A3C' },
  BREAKDOWN:  { verdict:"Lost 55 and 90. EMA 200 is the last line.",                  watch:"If 200 goes, structure is gone. No reason to hold.",         color:'#FF4F4F' },
  BEAR_WATCH: { verdict:"Below all three. Death cross not confirmed yet.",             watch:"Wait. Oversold RSI + bounce off a level = only reason to look.", color:'#CC2929' },
  BEAR_FULL:  { verdict:"Below all EMAs, bearishly stacked. Full downtrend.",         watch:"Don't. Wait for EMA 55 reclaim at minimum.",                 color:'#880E0E' },
  NEW_COIN:   { verdict:"Not enough history for EMA 200.",                            watch:"Trade 55 and 90 only. Higher risk, less data.",              color:'#555577' },
};

const RSI_EXPLAIN = (rsi) => {
  if (rsi === null) return null;
  if (rsi >= 75) return { label:'Overbought',  color:'#FF4F4F', text:`Don't chase. Let it breathe.` };
  if (rsi >= 60) return { label:'Hot',          color:'#FF9A3C', text:`Momentum is there. Don't get greedy.` };
  if (rsi >= 45) return { label:'Neutral',      color:'rgba(255,255,255,0.45)', text:`No edge either way. Watch the EMAs.` };
  if (rsi >= 35) return { label:'Cooling',      color:'#FFD93D', text:`Losing steam. Not a buy yet.` };
  if (rsi >= 25) return { label:'Oversold',     color:'#C8FF25', text:`Been sold hard. Bounce territory — confirm with structure.` };
  return           { label:'Deeply oversold', color:'#C8FF25', text:`Extreme. Could bounce or keep bleeding. Check if the project is still alive.` };
};

const MOM_EXPLAIN = (score) => {
  if (score >= 75) return { label:'Strong',    text:'Structure is clean. High conviction.' };
  if (score >= 55) return { label:'Mixed',     text:'Some positives, some flags. Not a clear setup.' };
  if (score >= 35) return { label:'Weak',      text:'More red than green. Better spots exist.' };
  return             { label:'Very weak',  text:'Everything is broken. Wait.' };
};

// Big sparkline for detail panel
const BigSpark = ({ data, color, high30, low30, price }) => {
  if (!data || data.length < 2) return null;
  const W = 400, H = 80;
  const allPts = data;
  const min = Math.min(...allPts), max = Math.max(...allPts);
  const range = max - min || 1;
  const toX = (i) => (i / (allPts.length - 1)) * W;
  const toY = (v) => H - ((v - min) / range) * (H - 4) - 2;
  const pts = allPts.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
  const up = allPts[allPts.length - 1] >= allPts[0];
  const areaPath = `M ${toX(0)},${toY(allPts[0])} ` + allPts.map((v,i)=>`L ${toX(i)},${toY(v)}`).join(' ') + ` L ${toX(allPts.length-1)},${H} L ${toX(0)},${H} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block', overflow:'visible' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up?'#C8FF25':'#FF4F4F'} stopOpacity="0.15"/>
          <stop offset="100%" stopColor={up?'#C8FF25':'#FF4F4F'} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <polyline points={pts} fill="none" stroke={up?'#C8FF25':'#FF4F4F'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Current price dot */}
      <circle cx={toX(allPts.length-1)} cy={toY(allPts[allPts.length-1])} r="3" fill={up?'#C8FF25':'#FF4F4F'}/>
    </svg>
  );
};

const DetailPanel = ({ coin, tech, onClose }) => {
  if (!coin || !tech) return null;
  const zone    = getZone(coin.price, tech.e55, tech.e90, tech.e200);
  const { label, color } = Z[zone];
  const explain = ZONE_EXPLAIN[zone];
  const rsiInfo = RSI_EXPLAIN(tech.rsi);
  const momInfo = MOM_EXPLAIN(tech.momentum);
  const up      = coin.ch >= 0;
  const momCol  = tech.momentum >= 70 ? '#C8FF25' : tech.momentum >= 45 ? '#FFD93D' : tech.momentum >= 25 ? '#FF9A3C' : '#FF4F4F';

  const nearestReclaim = [
    {name:'55',val:tech.e55},{name:'90',val:tech.e90},{name:'200',val:tech.e200},
  ].filter(t=>t.val!==null&&t.val>coin.price).sort((a,b)=>a.val-b.val)[0]||null;

  const signals = [];
  if (tech.cross==='GOLDEN') signals.push({label:'GOLDEN CROSS',desc:'55 crossed above 90. Bullish flip.',color:'#C8FF25'});
  if (tech.cross==='DEATH')  signals.push({label:'DEATH CROSS',desc:'55 crossed below 90. Bearish flip.',color:'#FF4F4F'});
  if (tech.rsi!==null&&tech.rsi<30) signals.push({label:'OVERSOLD',desc:'RSI under 30. Heavy selling — potential bounce zone. Confirm with structure first.',color:'#C8FF25'});
  if (tech.rsi!==null&&tech.rsi>72) signals.push({label:'OVERBOUGHT',desc:'RSI over 72. May be overextended after a run. Watch for a pullback.',color:'#FF4F4F'});

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:900}}/>
      <div style={{
        position:'fixed',top:0,right:0,bottom:0,width:'min(500px,100vw)',
        background:'#080808',
        borderLeft:'1px solid rgba(255,255,255,0.1)',
        zIndex:901,overflowY:'auto',overflowX:'hidden',
        animation:'slideIn 0.18s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* HEADER — newspaper masthead energy */}
        <div style={{position:'sticky',top:0,zIndex:10,background:'#080808'}}>
          <div style={{height:'4px',background:color}}/>
          <div style={{
            padding:'16px 20px 14px',
            borderBottom:'3px solid #fff',
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              {/* Ticker mega type */}
              <div>
                <div style={{
                  fontFamily:'"Bebas Neue",sans-serif',
                  fontSize:'clamp(56px,12vw,80px)',
                  color:'#fff',letterSpacing:'0.02em',lineHeight:0.85,
                }}>
                  {coin.display}
                </div>
                <div style={{
                  fontFamily:'"Bebas Neue",sans-serif',
                  fontSize:'22px',letterSpacing:'0.06em',
                  color:'rgba(255,255,255,0.35)',lineHeight:1,marginTop:'4px',
                }}>
                  ${fmt(coin.price)}
                  <span style={{color:up?'#C8FF25':'#FF4F4F',marginLeft:'12px'}}>
                    {up?'+':''}{coin.ch.toFixed(2)}%
                  </span>
                </div>
              </div>
              {/* Zone stamp — rotated label like a clothing tag */}
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'8px',paddingTop:'4px'}}>
                <div style={{
                  background:color,color:'#000',
                  fontFamily:'"Bebas Neue",sans-serif',
                  fontSize:'10px',fontWeight:700,letterSpacing:'0.22em',
                  padding:'4px 10px',textTransform:'uppercase',
                }}>{label}</div>
                <button onClick={onClose} style={{
                  all:'unset',cursor:'pointer',
                  fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',
                  letterSpacing:'0.22em',color:'rgba(255,255,255,0.3)',
                  textTransform:'uppercase',
                  transition:'color 0.1s',
                }}
                onMouseEnter={e=>e.currentTarget.style.color='#fff'}
                onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,0.3)'}>
                  ← Close
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div style={{padding:'0 20px 60px'}}>

          {/* CHART — full bleed, no box */}
          <div style={{margin:'20px -20px 0',padding:'0 20px'}}>
            <BigSpark data={tech.spark} color={color} high30={tech.high30} low30={tech.low30} price={coin.price}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:'4px'}}>
              <span style={{fontFamily:'monospace',fontSize:'9px',color:'rgba(255,255,255,0.2)',letterSpacing:'0.06em'}}>— 7 DAYS AGO</span>
              <span style={{fontFamily:'monospace',fontSize:'9px',color:'rgba(255,255,255,0.2)',letterSpacing:'0.06em'}}>NOW —</span>
            </div>
          </div>

          {/* VERDICT — the main read, big and raw */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',marginTop:'20px',paddingTop:'20px',marginBottom:'20px'}}>
            <div style={{
              fontFamily:'"Bebas Neue",sans-serif',
              fontSize:'11px',letterSpacing:'0.3em',
              color:'rgba(255,255,255,0.3)',marginBottom:'8px',
            }}>READ</div>
            <div style={{
              fontFamily:'"Bebas Neue",sans-serif',
              fontSize:'clamp(26px,5vw,32px)',
              color:'#fff',lineHeight:1.05,letterSpacing:'0.01em',
              marginBottom:'12px',
            }}>
              {explain.verdict.toUpperCase()}
            </div>
            <div style={{
              fontFamily:'"Barlow Condensed",sans-serif',
              fontWeight:400,fontSize:'14px',
              color:'rgba(255,255,255,0.55)',lineHeight:1.65,
            }}>
              {explain.verdict}
            </div>
          </div>

          {/* WATCH */}
          <div style={{borderLeft:`4px solid ${color}`,paddingLeft:'14px',marginBottom:'24px'}}>
            <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'10px',letterSpacing:'0.28em',color:color,marginBottom:'6px'}}>WATCH</div>
            <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:400,fontSize:'14px',color:'rgba(255,255,255,0.6)',lineHeight:1.6}}>
              {explain.watch}
            </div>
          </div>

          {/* SIGNALS — if any */}
          {signals.length > 0 && (
            <div style={{marginBottom:'24px'}}>
              {signals.map((s,i) => (
                <div key={i} style={{
                  display:'flex',gap:'12px',alignItems:'flex-start',
                  padding:'10px 0',
                  borderBottom:'1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{
                    fontFamily:'"Bebas Neue",sans-serif',
                    fontSize:'11px',letterSpacing:'0.2em',
                    color:s.color,whiteSpace:'nowrap',paddingTop:'1px',
                    minWidth:'90px',
                  }}>{s.label}</div>
                  <div style={{
                    fontFamily:'"Barlow Condensed",sans-serif',
                    fontWeight:400,fontSize:'13px',
                    color:'rgba(255,255,255,0.45)',lineHeight:1.5,
                  }}>{s.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* EMA LEVELS — raw data table, no decoration */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'4px'}}>
            <div style={{
              fontFamily:'"Bebas Neue",sans-serif',
              fontSize:'11px',letterSpacing:'0.3em',
              color:'rgba(255,255,255,0.3)',marginBottom:'2px',
            }}>LEVELS</div>
          </div>
          {[
            {name:'55', val:tech.e55,  label:''},
            {name:'90', val:tech.e90,  label:''},
            {name:'200',val:tech.e200, label:''},
          ].map(({name,val,label:lbl}) => {
            if (!val) return (
              <div key={name} style={{
                display:'flex',justifyContent:'space-between',
                padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',
                alignItems:'baseline',
              }}>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'18px',color:'rgba(255,255,255,0.2)',letterSpacing:'0.04em'}}>EMA {name}</div>
                <div style={{fontFamily:'monospace',fontSize:'11px',color:'rgba(255,255,255,0.18)',fontStyle:'italic'}}>—</div>
              </div>
            );
            const p = pct(coin.price,val);
            const above = coin.price > val;
            const fill = Math.min(100,Math.max(0,((p+50)/100)*100));
            return (
              <div key={name} style={{padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:'10px'}}>
                    <span style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'22px',color:'#fff',letterSpacing:'0.04em'}}>EMA {name}</span>
                    <span style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.14em',color:'rgba(255,255,255,0.3)'}}>{lbl}</span>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{fontFamily:'monospace',fontSize:'15px',fontWeight:700,color:'#fff'}}>${fmt(val)}</span>
                    <span style={{fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:above?'#C8FF25':'#FF4F4F',marginLeft:'10px'}}>{above?'+':''}{p.toFixed(1)}%</span>
                  </div>
                </div>
                <div style={{height:'2px',background:'rgba(255,255,255,0.06)'}}>
                  <div style={{height:'100%',width:`${fill}%`,background:above?'#C8FF25':'#FF4F4F',opacity:0.65}}/>
                </div>
              </div>
            );
          })}

          {/* RECLAIM TARGET */}
          {nearestReclaim && (
            <div style={{
              display:'flex',justifyContent:'space-between',alignItems:'baseline',
              padding:'14px 0',marginBottom:'4px',
              borderBottom:'2px solid rgba(255,255,255,0.15)',
            }}>
              <div>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.26em',color:'rgba(255,255,255,0.3)',marginBottom:'4px'}}>NEXT RECLAIM</div>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'20px',color:'#fff',letterSpacing:'0.03em'}}>
                  EMA {nearestReclaim.name} · ${fmt(nearestReclaim.val)}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'36px',color:'#FFD93D',letterSpacing:'-0.01em',lineHeight:1}}>
                  {Math.abs(pct(coin.price,nearestReclaim.val)).toFixed(1)}%
                </div>
  
              </div>
            </div>
          )}

          {/* RSI — big raw number, no decoration */}
          {rsiInfo && (
            <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'0'}}>
              <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.3em',color:'rgba(255,255,255,0.3)',marginBottom:'6px'}}>RSI</div>
              <div style={{display:'flex',alignItems:'baseline',gap:'14px',marginBottom:'10px'}}>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'80px',color:'#fff',lineHeight:0.85,letterSpacing:'-0.02em'}}>{tech.rsi.toFixed(0)}</div>
                <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'18px',color:rsiInfo.color,letterSpacing:'0.1em',textTransform:'uppercase',alignSelf:'center'}}>{rsiInfo.label}</div>
              </div>
              {/* minimal bar */}
              <div style={{height:'2px',background:'rgba(255,255,255,0.07)',position:'relative',marginBottom:'6px'}}>
                <div style={{position:'absolute',left:'30%',top:'-2px',width:'1px',height:'6px',background:'rgba(200,255,37,0.25)'}}/>
                <div style={{position:'absolute',left:'70%',top:'-2px',width:'1px',height:'6px',background:'rgba(255,79,79,0.25)'}}/>
                <div style={{position:'absolute',top:'-4px',left:`${Math.min(tech.rsi,99)}%`,transform:'translateX(-50%)',width:'2px',height:'10px',background:rsiInfo.color}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'12px'}}>
                <span style={{fontFamily:'monospace',fontSize:'8px',color:'rgba(200,255,37,0.35)',letterSpacing:'0.1em'}}>OVERSOLD</span>
                <span style={{fontFamily:'monospace',fontSize:'8px',color:'rgba(255,79,79,0.35)',letterSpacing:'0.1em'}}>OVERBOUGHT</span>
              </div>
              <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:400,fontSize:'13px',color:'rgba(255,255,255,0.5)',lineHeight:1.6,marginBottom:'20px'}}>{rsiInfo.text}</div>
            </div>
          )}

          {/* MOMENTUM */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'0'}}>
            <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.3em',color:'rgba(255,255,255,0.3)',marginBottom:'6px'}}>MOMENTUM</div>
            <div style={{display:'flex',alignItems:'baseline',gap:'14px',marginBottom:'10px'}}>
              <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'80px',color:'#fff',lineHeight:0.85,letterSpacing:'-0.02em'}}>{tech.momentum}</div>
              <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'18px',color:momCol,letterSpacing:'0.1em',textTransform:'uppercase',alignSelf:'center'}}>{momInfo.label}</div>
            </div>
            <div style={{height:'2px',background:'rgba(255,255,255,0.07)',marginBottom:'12px'}}>
              <div style={{height:'100%',width:`${tech.momentum}%`,background:'#C8FF25',opacity:0.8}}/>
            </div>
            <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:400,fontSize:'13px',color:'rgba(255,255,255,0.5)',lineHeight:1.6,marginBottom:'16px'}}>{momInfo.text}</div>
            {/* checklist */}
            {[
              {label:'Above EMA 55',          pass:!!(tech.e55&&coin.price>tech.e55),  pts:13},
              {label:'Above EMA 90',           pass:!!(tech.e90&&coin.price>tech.e90),  pts:13},
              {label:'Above EMA 200',          pass:!!(tech.e200&&coin.price>tech.e200),pts:14},
              {label:'EMAs stacked bullishly', pass:!!(tech.e55&&tech.e90&&tech.e200&&tech.e55>tech.e90&&tech.e90>tech.e200),pts:30},
              {label:'RSI score',              pass:tech.rsi!==null, pts:tech.rsi?Math.round((tech.rsi/100)*30):0},
            ].map(({label:lbl,pass,pts})=>(
              <div key={lbl} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
                  <span style={{fontFamily:'monospace',fontSize:'11px',color:pass?'#C8FF25':'rgba(255,255,255,0.18)',fontWeight:700,minWidth:'12px'}}>{pass?'✓':'—'}</span>
                  <span style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:600,fontSize:'14px',letterSpacing:'0.06em',color:pass?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.25)',textTransform:'uppercase'}}>{lbl}</span>
                </div>
                <span style={{fontFamily:'monospace',fontSize:'12px',fontWeight:700,color:pass?'#C8FF25':'rgba(255,255,255,0.15)'}}>{pass?`+${pts}`:''}</span>
              </div>
            ))}
          </div>

          {/* 30D RANGE */}
          {tech.high30 && tech.low30 && (
            <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginTop:'20px'}}>
              <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.3em',color:'rgba(255,255,255,0.3)',marginBottom:'14px'}}>30D</div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'10px'}}>
                <div>
                  <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.2em',color:'rgba(255,255,255,0.3)',marginBottom:'2px'}}>HIGH</div>
                  <div style={{fontFamily:'monospace',fontSize:'16px',fontWeight:700,color:'#C8FF25'}}>${fmt(tech.high30)}</div>
                  <div style={{fontFamily:'monospace',fontSize:'10px',color:'rgba(255,255,255,0.3)',marginTop:'2px'}}>{pct(coin.price,tech.high30)?.toFixed(1)}% from now</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.2em',color:'rgba(255,255,255,0.3)',marginBottom:'2px'}}>NOW</div>
                  <div style={{fontFamily:'monospace',fontSize:'16px',fontWeight:700,color:'#fff'}}>${fmt(coin.price)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:'"Bebas Neue",sans-serif',fontSize:'11px',letterSpacing:'0.2em',color:'rgba(255,255,255,0.3)',marginBottom:'2px'}}>LOW</div>
                  <div style={{fontFamily:'monospace',fontSize:'16px',fontWeight:700,color:'#FF4F4F'}}>${fmt(tech.low30)}</div>
                  <div style={{fontFamily:'monospace',fontSize:'10px',color:'rgba(255,255,255,0.3)',marginTop:'2px'}}>+{Math.abs(pct(coin.price,tech.low30))?.toFixed(1)}% above</div>
                </div>
              </div>
              {tech.high30!==tech.low30 && (
                <>
                  <div style={{height:'2px',background:'rgba(255,255,255,0.07)',position:'relative',marginBottom:'6px'}}>
                    <div style={{position:'absolute',top:'-4px',left:`${((coin.price-tech.low30)/(tech.high30-tech.low30))*100}%`,transform:'translateX(-50%)',width:'2px',height:'10px',background:'#fff'}}/>
                  </div>
                  <div style={{fontFamily:'monospace',fontSize:'9px',color:'rgba(255,255,255,0.2)',textAlign:'center',letterSpacing:'0.08em'}}>
                    {(((coin.price-tech.low30)/(tech.high30-tech.low30))*100).toFixed(0)}%  of 30d range
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  );
};


// Skeleton
const Skel = () => (
  <div style={{ height:'320px', background:'rgba(255,255,255,0.012)', border:'1px solid rgba(255,255,255,0.05)', overflow:'hidden', position:'relative' }}>
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.022),transparent)', animation:'sweep 1.8s ease-in-out infinite' }} />
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// CARD
// ═══════════════════════════════════════════════════════════════════════════════

const Card = ({ coin, tech, pinned, onClick }) => {
  const zone = getZone(coin.price, tech.e55, tech.e90, tech.e200);
  const { label, color, dim, glow } = Z[zone];
  const isFull = zone === 'FULL_BULL';
  const up = coin.ch >= 0;

  const nearestReclaim = useMemo(() => {
    const targets = [
      { name:'55', val:tech.e55 },
      { name:'90', val:tech.e90 },
      { name:'200', val:tech.e200 },
    ].filter(t => t.val !== null && t.val > coin.price)
     .sort((a, b) => a.val - b.val);
    return targets[0] || null;
  }, [tech, coin.price]);

  const signals = [];
  if (tech.cross === 'GOLDEN') signals.push({ label:'⚡ GOLDEN X', color:'#C8FF25' });
  if (tech.cross === 'DEATH')  signals.push({ label:'☠ DEATH X', color:'#FF4F4F' });
  if (tech.rsi !== null && tech.rsi < 30) signals.push({ label:'OS RSI', color:'#C8FF25' });
  if (tech.rsi !== null && tech.rsi > 72) signals.push({ label:'OB RSI', color:'#FF4F4F' });
  if (nearestReclaim && Math.abs(pct(coin.price, nearestReclaim.val)) < 3) signals.push({ label:`~EMA${nearestReclaim.name}`, color:'#FFD93D' });

  return (
    <div
      onClick={onClick}
      style={{
        background: dim,
        border:`1px solid ${color}${isFull?'50':'1E'}`,
        boxShadow:'none',
        display:'flex', flexDirection:'column',
        padding:'0', cursor:'pointer',
        transition:'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
        position:'relative', overflow:'hidden',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor=color+'77';  e.currentTarget.style.transform='translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor=color+(isFull?'50':'1E'); e.currentTarget.style.boxShadow='none'; e.currentTarget.style.transform='none'; }}
    >
      <div style={{ height:'2px', background:`linear-gradient(90deg,${color},${color}33)`, opacity:isFull?1:0.5 }} />
      <div style={{ padding:'14px 16px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'12px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <span style={{ fontFamily:'"Bebas Neue",sans-serif', fontSize:'26px', letterSpacing:'0.05em', color:'#fff', lineHeight:1 }}>{coin.display}</span>
              {pinned && <span style={{ fontFamily:'monospace', fontSize:'7px', color:'#C8FF25', padding:'1px 4px', border:'1px solid #C8FF2544' }}>★</span>}
            </div>
            <div style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.45)', marginTop:'3px' }}>${(coin.vol/1e6).toFixed(0)}M vol</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:'monospace', fontSize:'15px', fontWeight:700, color:'#fff' }}>${fmt(coin.price)}</div>
            <div style={{ display:'flex', alignItems:'center', gap:'3px', justifyContent:'flex-end', marginTop:'3px' }}>
              <svg width="6" height="6" viewBox="0 0 6 6">
                {up ? <polygon points="3,0 6,6 0,6" fill="#C8FF25"/> : <polygon points="0,0 6,0 3,6" fill="#FF4F4F"/>}
              </svg>
              <span style={{ fontFamily:'monospace', fontSize:'12px', fontWeight:700, color:up?'#C8FF25':'#FF4F4F' }}>{up?'+':''}{coin.ch.toFixed(2)}%</span>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px', gap:'8px' }}>
          <Spark data={tech.spark} color={color} />
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
              <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.55)', textTransform:'uppercase' }}>Score</span>
              <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{tech.atr ? `±${fmt(tech.atr)}` : ''}</span>
            </div>
            <MomentumBar score={tech.momentum} />
          </div>
        </div>
        {signals.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px', marginBottom:'10px' }}>
            {signals.map((s,i) => <SignalTag key={i} label={s.label} color={s.color} />)}
          </div>
        )}
        <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'10px' }}>
          <EmaRow label="55"  val={tech.e55}  price={coin.price} color={color} />
          <EmaRow label="90"  val={tech.e90}  price={coin.price} color={color} />
          <EmaRow label="200" val={tech.e200} price={coin.price} color={color} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:'8px', borderTop:'1px solid rgba(255,255,255,0.05)', marginBottom:'10px' }}>
          {tech.rsi !== null ? (
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.6)', fontWeight:500 }}>RSI</span>
              <div style={{ width:'48px', height:'2px', background:'rgba(255,255,255,0.07)', position:'relative' }}>
                <div style={{ position:'absolute', left:'30%', top:0, width:'1px', height:'100%', background:'rgba(200,255,37,0.15)' }} />
                <div style={{ position:'absolute', left:'70%', top:0, width:'1px', height:'100%', background:'rgba(255,79,79,0.2)' }} />
                <div style={{ position:'absolute', top:'-2px', left:`${Math.min(tech.rsi,99)}%`, transform:'translateX(-50%)', width:'3px', height:'6px', background:tech.rsi>70?'#FF4F4F':tech.rsi<30?'#C8FF25':'rgba(255,255,255,0.4)', borderRadius:'1px' }} />
              </div>
              <span style={{ fontFamily:'monospace', fontSize:'13px', fontWeight:700, color:tech.rsi>70?'#FF4F4F':tech.rsi<30?'#C8FF25':'#fff' }}>{tech.rsi.toFixed(1)}</span>
            </div>
          ) : <span />}
        </div>
        {nearestReclaim && (
          <div style={{ padding:'6px 8px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', marginBottom:'10px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontFamily:'monospace', fontSize:'10px', color:'rgba(255,255,255,0.5)', textTransform:'uppercase' }}>Reclaim</span>
              <div style={{ display:'flex', gap:'8px' }}>
                <span style={{ fontFamily:'monospace', fontSize:'11px', color:'rgba(255,255,255,0.7)' }}>EMA {nearestReclaim.name}</span>
                <span style={{ fontFamily:'monospace', fontSize:'11px', fontWeight:700, color:'#FFD93D' }}>${fmt(nearestReclaim.val)}</span>
                <span style={{ fontFamily:'monospace', fontSize:'11px', color:'rgba(255,255,255,0.55)' }}>{Math.abs(pct(coin.price,nearestReclaim.val)).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}
        <div style={{ padding:'5px 0', textAlign:'center', background:isFull?color:`${color}15`, border:isFull?'none':`1px solid ${color}30`, color:isFull?'#000':color, fontFamily:'"Bebas Neue",sans-serif', fontSize:'12px', letterSpacing:'0.28em' }}>
          {label}
        </div>
      </div>
    </div>
  );
};

// Filter pill
const Pill = ({ label, color, count, active, onClick }) => (
  <button onClick={onClick} style={{
    all:'unset', cursor:'pointer',
    display:'inline-flex', alignItems:'center', gap:'5px',
    padding:'5px 11px',
    border:`1px solid ${active ? color+'AA' : 'rgba(255,255,255,0.1)'}`,
    background: active ? `${color}15` : 'transparent',
    fontFamily:'"Bebas Neue",sans-serif',
    fontSize:'13px', letterSpacing:'0.16em',
    color: active ? color : 'rgba(255,255,255,0.3)',
    transition:'all 0.12s', whiteSpace:'nowrap',
  }}>
    {label}
    <span style={{ fontFamily:'monospace', fontSize:'10px', color: active ? color+'CC' : 'rgba(255,255,255,0.35)', fontWeight:700 }}>{count}</span>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════

// Stablecoins, wrapped assets, fiat pairs, and dead tickers
const DENYLIST = new Set([
  // Stablecoins & fiat
  'EURUSDT', 'EURУСDT',
  'RLUSDUSDT', 'USDCUSDT', 'USD1USDT', 'FDUSDUSDT',
  'XUSDUSDT', 'UUSDT', 'BFUSDUSDT', 'BUSDUSDT',
  // Wrapped assets
  'WBTCUSDT', 'WBETHUSDT',
  // Rebranded / dead
  'RNDRUSDT',   // rebranded → RENDERUSDT
  'LUNA2USDT',  // dead
  'USTCUSDT',   // dead
  'COCOSUSDT',   // removed
  'FTMUSDT',    // rebranded → SONIC
]);

export default function VaultTerminal() {
  const [coins,    setCoins]    = useState([]);
  const [techMap,  setTechMap]  = useState({});
  const [progress, setProgress] = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [fetching, setFetching] = useState(false);
  const [zFilter,  setZFilter]  = useState('ALL');
  const [sortBy,   setSortBy]   = useState('VOL');
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const searchRef = useRef(null);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetch('https://api.binance.com/api/v3/ticker/24hr')
      .then(r => r.json())
      .then(data => {
        const byVol = data
          .filter(p => p.symbol.endsWith('USDT') && parseFloat(p.quoteVolume) > 1e6 && !DENYLIST.has(p.symbol))
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 193)
          .map(p => p.symbol);

        const symSet = new Set([...PINNED, ...byVol]);
        const allSyms = [...symSet].slice(0, 200);

        const coinList = allSyms.map(sym => {
          const p = data.find(x => x.symbol === sym) || {};
          return {
            symbol:  sym,
            display: sym.replace('USDT', ''),
            price:   parseFloat(p.lastPrice || 0),
            vol:     parseFloat(p.quoteVolume || 0),
            ch:      parseFloat(p.priceChangePercent || 0),
            pinned:  PINNED.includes(sym),
          };
        });

        setCoins(coinList);
        setLoading(false);
        setFetching(true);

        fetchAllKlines(allSyms, (n) => setProgress(n))
          .then(map => { setTechMap(map); setFetching(false); });
      })
      .catch(console.error);
  }, []);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ZK.map(k => [k, 0]));
    coins.forEach(({ symbol, price }) => {
      const t = techMap[symbol];
      if (!t) return;
      c[getZone(price, t.e55, t.e90, t.e200)]++;
    });
    return c;
  }, [coins, techMap]);

  const total   = Object.values(counts).reduce((a, b) => a + b, 0);
  const bullN   = (counts.FULL_BULL||0) + (counts.ABOVE_ALL||0);
  const bearN   = (counts.BEAR_WATCH||0) + (counts.BEAR_FULL||0);
  const bullPct = total > 0 ? Math.round(bullN / total * 100) : 0;

  // Coins with alpha signals — for the "signals" tab
  const signalCoins = useMemo(() => {
    return coins.filter(c => {
      const t = techMap[c.symbol];
      if (!t) return false;
      return t.cross || (t.rsi && (t.rsi < 30 || t.rsi > 72));
    });
  }, [coins, techMap]);

  const displayed = useMemo(() => {
    let list = coins.filter(c => techMap[c.symbol]);

    // Search filter
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter(c => c.display.includes(q) || c.symbol.includes(q));
    }

    // Zone filter
    if (zFilter === 'SIGNALS') {
      list = list.filter(c => {
        const t = techMap[c.symbol];
        return t && (t.cross || (t.rsi && (t.rsi < 30 || t.rsi > 72)));
      });
    } else if (zFilter !== 'ALL') {
      list = list.filter(c => {
        const t = techMap[c.symbol];
        return t && getZone(c.price, t.e55, t.e90, t.e200) === zFilter;
      });
    }

    // Sort
    if (sortBy === 'VOL')      list.sort((a,b) => b.vol - a.vol);
    if (sortBy === 'CH_UP')    list.sort((a,b) => b.ch - a.ch);
    if (sortBy === 'CH_DOWN')  list.sort((a,b) => a.ch - b.ch);
    if (sortBy === 'RSI_HI')   list.sort((a,b) => (techMap[b.symbol]?.rsi??50) - (techMap[a.symbol]?.rsi??50));
    if (sortBy === 'RSI_LO')   list.sort((a,b) => (techMap[a.symbol]?.rsi??50) - (techMap[b.symbol]?.rsi??50));
    if (sortBy === 'MOMENTUM') list.sort((a,b) => (techMap[b.symbol]?.momentum??0) - (techMap[a.symbol]?.momentum??0));
    if (sortBy === 'GAP')      list.sort((a,b) => {
      const ga = techMap[a.symbol]?.e200 ? Math.abs(pct(a.price, techMap[a.symbol].e200)) : -1;
      const gb = techMap[b.symbol]?.e200 ? Math.abs(pct(b.price, techMap[b.symbol].e200)) : -1;
      return gb - ga;
    });

    // Pinned always on top (unless sorted otherwise)
    if (sortBy === 'VOL') list.sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.vol - a.vol);

    return list;
  }, [coins, techMap, zFilter, sortBy, search]);

  const TABS = [
    { key:'ALL',     label:'ALL',     color:'#ffffff',  count: total },
    { key:'SIGNALS', label:'SIGNALS', color:'#FF9A3C',  count: signalCoins.length },
    ...ZK.map(k => ({ key:k, label:Z[k].label, color:Z[k].color, count:counts[k]||0 })),
  ];
  const SORTS = [
    {key:'VOL',       label:'Volume'  },
    {key:'MOMENTUM',  label:'Score'   },    {key:'CH_UP',     label:'24h ↑'   },
    {key:'CH_DOWN',   label:'24h ↓'   },
    {key:'RSI_HI',    label:'RSI Hi'  },
    {key:'RSI_LO',    label:'RSI Lo'  },
    {key:'GAP',       label:'EMA Gap' },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;700&family=DM+Mono:wght@400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#050505;-webkit-font-smoothing:antialiased}
        @keyframes sweep{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
        @keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08)}
        ::selection{background:rgba(200,255,37,0.15);color:#C8FF25}
        input::placeholder{color:rgba(255,255,255,0.35)}
        input:focus{outline:none}
      `}</style>

      <div style={{ minHeight:'100vh', background:'#050505', color:'#fff' }}>

        {/* ── TOPBAR ── */}
        <header style={{
          position:'sticky', top:0, zIndex:300,
          background:'rgba(5,5,5,0.97)', backdropFilter:'blur(24px)',
          borderBottom:'1px solid rgba(255,255,255,0.07)',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0 24px', height:'46px', gap:'16px',
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px', flexShrink:0 }}>
            <span style={{ fontFamily:'"Bebas Neue",sans-serif', fontSize:'16px', letterSpacing:'0.18em', color:'#C8FF25' }}>MOONS EMA SCANNER</span>
            <span style={{ width:'1px', height:'12px', background:'rgba(255,255,255,0.12)' }} />
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.14em' }}>EMA 55·90·200 · RSI · SIGNALS</span>
          </div>

          {/* Search bar */}
          <div style={{ flex:'1', maxWidth:'280px', position:'relative', display:'flex', alignItems:'center' }}>
            <svg style={{ position:'absolute', left:'10px', opacity:0.3 }} width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="4" stroke="white" strokeWidth="1.5"/>
              <line x1="8.5" y1="8.5" x2="11" y2="11" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='Search…'
              style={{
                width:'100%',
                background:'rgba(255,255,255,0.04)',
                border:'1px solid rgba(255,255,255,0.1)',
                color:'#fff',
                fontFamily:'"DM Mono",monospace',
                fontSize:'13px',
                letterSpacing:'0.06em',
                padding:'7px 10px 7px 30px',
                transition:'border-color 0.15s',
              }}
              onFocus={e => e.target.parentElement.querySelector('input').style.borderColor='rgba(200,255,37,0.4)'}
              onBlur={e => e.target.style.borderColor='rgba(255,255,255,0.1)'}
            />
            {search && (
              <button onClick={()=>setSearch('')} style={{ all:'unset', cursor:'pointer', position:'absolute', right:'8px', color:'rgba(255,255,255,0.3)', fontSize:'14px', lineHeight:1 }}>×</button>
            )}
          </div>


        </header>

        {/* ── HERO ── */}
        <section style={{ padding:'44px 24px 32px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'24px' }}>
            <div>
              <h1 style={{
                fontFamily:'"Bebas Neue",sans-serif',
                fontSize:'clamp(68px,10vw,128px)',
                letterSpacing:'0.04em', lineHeight:0.85,
                color:'#fff',
              }}>MOONS</h1>

            </div>

          </div>

          {/* Sentiment bar */}
          <div style={{ marginTop:'24px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'5px' }}>
              <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'11px', color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em' }}>BULL {bullN} · {bullPct}%</span>
              <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'11px', color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em' }}>BEAR {bearN} · {total>0?Math.round(bearN/total*100):0}%</span>
            </div>
            <div style={{ height:'3px', background:'rgba(255,79,79,0.2)' }}>
              <div style={{ height:'100%', width:`${bullPct}%`, background:'#C8FF25', transition:'width 1s ease' }} />
            </div>
          </div>
        </section>

        {/* ── CONTROLS ── */}
        <div style={{
          position:'sticky', top:'46px', zIndex:200,
          background:'rgba(5,5,5,0.97)', backdropFilter:'blur(24px)',
          borderBottom:'1px solid rgba(255,255,255,0.06)',
        }}>
          {/* Filter tabs */}
          <div style={{ padding:'8px 24px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'8px', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
              {TABS.map(t => <Pill key={t.key} label={t.label} color={t.color} count={t.count} active={zFilter===t.key} onClick={()=>setZFilter(t.key)} />)}
            </div>
          </div>
          {/* Sort row */}
          <div style={{ padding:'6px 24px', display:'flex', alignItems:'center', gap:'4px', flexWrap:'wrap' }}>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'10px', color:'rgba(255,255,255,0.45)', letterSpacing:'0.12em', marginRight:'8px' }}>SORT</span>
            {SORTS.map(s => (
              <button key={s.key} onClick={()=>setSortBy(s.key)} style={{
                all:'unset', cursor:'pointer',
                fontFamily:'"DM Mono",monospace', fontSize:'10px', letterSpacing:'0.06em', textTransform:'uppercase',
                padding:'4px 9px', whiteSpace:'nowrap',
                color: sortBy===s.key ? '#fff' : 'rgba(255,255,255,0.5)',
                background: sortBy===s.key ? 'rgba(255,255,255,0.08)' : 'transparent',
                border:`1px solid ${sortBy===s.key?'rgba(255,255,255,0.18)':'transparent'}`,
                transition:'all 0.12s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* ── GRID ── */}
        <main style={{ padding:'18px 24px 60px' }}>
          {loading ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'8px' }}>
              {Array.from({length:24}).map((_,i)=><Skel key={i}/>)}
            </div>
          ) : displayed.length === 0 ? (
            <div style={{ textAlign:'center', padding:'80px 0' }}>
              <div style={{ fontFamily:'"Bebas Neue",sans-serif', fontSize:'22px', letterSpacing:'0.3em', color:'rgba(255,255,255,0.35)' }}>
                {search ? `NO RESULTS FOR "${search.toUpperCase()}"` : 'NO ASSETS MATCH'}
              </div>
            </div>
          ) : (
            <>
              {search && (
                <div style={{ marginBottom:'12px', fontFamily:'"DM Mono",monospace', fontSize:'11px', color:'rgba(255,255,255,0.5)', letterSpacing:'0.1em' }}>
                  {displayed.length} result{displayed.length!==1?'s':''} for "{search.toUpperCase()}"
                </div>
              )}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'8px' }}>
                {displayed.map(c => (
                  <div key={c.symbol} style={{ animation:'fadein 0.25s ease both' }}>
                    <Card coin={c} tech={techMap[c.symbol]} pinned={c.pinned} onClick={()=>setSelected(c.symbol)} />
                  </div>
                ))}
                {fetching && coins.filter(c=>!techMap[c.symbol]).slice(0,8).map(c=><Skel key={'sk'+c.symbol}/>)}
              </div>
            </>
          )}
        </main>

        {/* ── FOOTER ── */}
        <footer style={{ borderTop:'1px solid rgba(255,255,255,0.05)', padding:'14px 24px', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
            Not financial advice
          </span>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
            Binance · Daily closes
          </span>
        </footer>

        {/* ── DETAIL PANEL ── */}
        {selected && techMap[selected] && (
          <DetailPanel
            coin={coins.find(c=>c.symbol===selected)}
            tech={techMap[selected]}
            onClose={()=>setSelected(null)}
          />
        )}
      </div>
    </>
  );
}
