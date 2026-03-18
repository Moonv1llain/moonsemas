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
  FULL_BULL:  { label:'FULL BULL',  color:'#CCFF00', dim:'rgba(204,255,0,0.05)',   glow:'none' },
  ABOVE_ALL:  { label:'ABOVE ALL',  color:'#88CC00', dim:'rgba(136,204,0,0.05)',   glow:'none' },
  COILING:    { label:'COILING',    color:'#F5A200', dim:'rgba(245,162,0,0.05)',   glow:'none' },
  RECOVERY:   { label:'RECOVERY',   color:'#F5A200', dim:'rgba(245,162,0,0.04)',   glow:'none' },
  BREAKDOWN:  { label:'BREAKDOWN',  color:'#FF2D55', dim:'rgba(255,45,85,0.05)',   glow:'none' },
  BEAR_WATCH: { label:'BEAR WATCH', color:'#FF2D55', dim:'rgba(255,45,85,0.04)',   glow:'none' },
  BEAR_FULL:  { label:'BEAR FULL',  color:'#CC2200', dim:'rgba(204,34,0,0.05)',   glow:'none' },
  NEW_COIN:   { label:'NEW COIN',   color:'#444444', dim:'rgba(68,68,68,0.04)',   glow:'none' },
};
const ZK = Object.keys(Z);

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH
// ═══════════════════════════════════════════════════════════════════════════════

const PINNED = ['INJUSDT','SUIUSDT','APTUSDT','TIAUSDT','SOLUSDT','ETHUSDT','BTCUSDT'];

// Tokens not on Binance — sourced from Bybit or Kraken
const EXTRA_TOKENS = [
  { display:'HYPE',     source:'bybit',  bybit:'HYPEUSDT'          },
  { display:'MOG',      source:'bybit',  bybit:'MOGUSDT'           },
  { display:'KAS',      source:'bybit',  bybit:'KASUSDT'           },
  { display:'MEW',      source:'bybit',  bybit:'MEWUSDT'           },
  { display:'XMR',      source:'kraken', kraken:'XMRUSDT'          },
  { display:'FARTCOIN', source:'kraken', kraken:'FARTCOINUSD'      },
];

// ── Bybit ─────────────────────────────────────────────────────────────────────
const fetchBybitTicker = async (sym) => {
  const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${sym}`);
  const j = await r.json();
  const d = j?.result?.list?.[0];
  if (!d) return null;
  return {
    price: parseFloat(d.lastPrice   || 0),
    vol:   parseFloat(d.turnover24h || 0), // already in USDT
    ch:    parseFloat(d.price24hPcnt|| 0) * 100,
  };
};

// Bybit klines: interval=D, newest first — must reverse
const fetchBybitKlines = async (sym, display) => {
  const r = await fetch(
    `https://api.bybit.com/v5/market/kline?category=spot&symbol=${sym}&interval=D&limit=250`
  );
  const j = await r.json();
  const raw = j?.result?.list;
  if (!Array.isArray(raw) || raw.length < 30) return null;
  // Bybit returns [startTime, open, high, low, close, volume, turnover] newest→oldest
  const candles = [...raw].reverse();
  const closes = candles.map(k => parseFloat(k[4]));
  const highs   = candles.map(k => parseFloat(k[2]));
  const lows    = candles.map(k => parseFloat(k[3]));
  return buildTech(closes, highs, lows, display, 'bybit');
};

// ── Kraken ────────────────────────────────────────────────────────────────────
const fetchKrakenTicker = async (pair) => {
  const r = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
  const j = await r.json();
  if (j.error?.length || !j.result) return null;
  const d = Object.values(j.result)[0];
  // c = last trade [price, vol], v = volume [today, 24h], p = vwap [today, 24h]
  const price = parseFloat(d.c[0]);
  const vol   = parseFloat(d.v[1]) * price; // 24h vol * price = USDT approx
  const vwap  = parseFloat(d.p[1]);
  const open  = parseFloat(d.o);
  const ch    = open > 0 ? ((price - open) / open) * 100 : 0;
  return { price, vol, ch };
};

// Kraken OHLC: interval=1440 (daily), returns oldest→newest
// [time, open, high, low, close, vwap, volume, count]
const fetchKrakenKlines = async (pair, display) => {
  const since = Math.floor((Date.now() - 250 * 86400000) / 1000);
  const r = await fetch(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${since}`
  );
  const j = await r.json();
  if (j.error?.length || !j.result) return null;
  const raw = Object.values(j.result).find(v => Array.isArray(v));
  if (!raw || raw.length < 30) return null;
  const closes = raw.map(k => parseFloat(k[4]));
  const highs   = raw.map(k => parseFloat(k[2]));
  const lows    = raw.map(k => parseFloat(k[3]));
  return buildTech(closes, highs, lows, display, 'kraken');
};

// ── Shared tech builder ───────────────────────────────────────────────────────
const buildTech = (closes, highs, lows, display, source) => {
  const e55  = calcEMA(closes, 55);
  const e90  = calcEMA(closes, 90);
  const e200 = calcEMA(closes, 200);
  const rsiVal = calcRSI(closes);
  const price  = closes[closes.length - 1];
  return {
    sym:      display + 'USDT',
    e55, e90, e200,
    rsi:      rsiVal,
    atr:      calcATR(highs, lows, closes),
    momentum: calcMomentum(price, e55, e90, e200, rsiVal),
    cross:    detectCross(closes),
    spark:    closes.slice(-8),
    high30:   Math.max(...closes.slice(-30)),
    low30:    Math.min(...closes.slice(-30)),
    source,
  };
};

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
            spark:      closes.slice(-8),
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
const Spark = ({ data }) => {
  if (!data || data.length < 2) return null;
  const W = 60, H = 22;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*W},${H-((v-min)/range)*H}`).join(' ');
  const up = data[data.length-1] >= data[0];
  return (
    <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
      <polyline points={pts} fill="none" stroke={up?'#CCFF00':'#FF2D55'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// Momentum score bar
const MomentumBar = ({ score }) => {
  const col = score>=70?'#CCFF00':score>=45?'#F5A200':score>=25?'#FFE500':'#FF2D55';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <div style={{ flex:1, height:'3px', background:'rgba(255,255,255,0.06)' }}>
        <div style={{ height:'100%', width:`${score}%`, background:col, transition:'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily:MONO, fontSize:'10px', fontWeight:700, color:col, minWidth:'26px', textAlign:'right' }}>{score}</span>
    </div>
  );
};

// EMA row
const EmaRow = ({ label, val, price }) => {
  const above = val !== null && price > val;
  const p = val !== null ? pct(price, val) : null;
  const col = above ? '#CCFF00' : '#FF2D55';
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.14em' }}>E{label}</span>
      <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
        <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff' }}>{val?`$${fmt(val)}`:'—'}</span>
        <span style={{ fontFamily:MONO, fontSize:'9px', fontWeight:700, color:col, minWidth:'46px', textAlign:'right' }}>
          {p!==null?(above?'+':'')+p.toFixed(1)+'%':'—'}
        </span>
      </div>
    </div>
  );
};

// Signal tag — bracket style
const SignalTag = ({ label, color }) => (
  <span style={{
    fontFamily:MONO, fontSize:'8px', fontWeight:700,
    letterSpacing:'0.1em', padding:'2px 6px',
    color, background:color+'12',
    border:`1px solid ${color}44`,
    whiteSpace:'nowrap', textTransform:'uppercase',
  }}>[{label}_]</span>
);


// ═══════════════════════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════════

// Plain-English explanations per zone
const ZONE_EXPLAIN = {
  FULL_BULL:  { verdict:"Above all EMAs, stacked right. Trend is clean.",             watch:"Dips to EMA 55 are the entry.",                              color:'#CCFF00' },
  ABOVE_ALL:  { verdict:"Above all EMAs but not fully stacked yet.",                  watch:"Wait for 55 > 90 > 200 alignment before sizing in.",         color:'#CCFF00' },
  COILING:    { verdict:"Above 200, lost the 55 and 90. Compressing.",                watch:"Reclaim 55 = next leg up. Lose 200 = bail.",                 color:'#FFE500' },
  RECOVERY:   { verdict:"Reclaimed 55 and 90 but 200 is still overhead.",             watch:"EMA 200 is the wall. Break it or this stalls.",              color:'#FF6B00' },
  BREAKDOWN:  { verdict:"Lost 55 and 90. EMA 200 is the last line.",                  watch:"If 200 goes, structure is gone. No reason to hold.",         color:'#FF2D55' },
  BEAR_WATCH: { verdict:"Below all three. Death cross not confirmed yet.",             watch:"Wait. Oversold RSI + bounce off a level = only reason to look.", color:'#FF2D55' },
  BEAR_FULL:  { verdict:"Below all EMAs, bearishly stacked. Full downtrend.",         watch:"Don't. Wait for EMA 55 reclaim at minimum.",                 color:'#CC2200' },
  NEW_COIN:   { verdict:"Not enough history for EMA 200.",                            watch:"Trade 55 and 90 only. Higher risk, less data.",              color:'#505050' },
};

const RSI_EXPLAIN = (rsi) => {
  if (rsi === null) return null;
  if (rsi >= 75) return { label:'Overbought',  color:'#FF2D55', text:`Don't chase. Let it breathe.` };
  if (rsi >= 60) return { label:'Hot',          color:'#FF6B00', text:`Momentum is there. Don't get greedy.` };
  if (rsi >= 45) return { label:'Neutral',      color:'#fff', text:`No edge either way. Watch the EMAs.` };
  if (rsi >= 35) return { label:'Cooling',      color:'#FFE500', text:`Losing steam. Not a buy yet.` };
  if (rsi >= 25) return { label:'Oversold',     color:'#CCFF00', text:`Been sold hard. Bounce territory — confirm with structure.` };
  return           { label:'Deeply oversold', color:'#CCFF00', text:`Extreme. Could bounce or keep bleeding. Check if the project is still alive.` };
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
          <stop offset="0%" stopColor={up?'#CCFF00':'#FF2D55'} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={up?'#CCFF00':'#FF2D55'} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <polyline points={pts} fill="none" stroke={up?'#CCFF00':'#FF2D55'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Current price dot */}
      <circle cx={toX(allPts.length-1)} cy={toY(allPts[allPts.length-1])} r="3" fill={up?'#CCFF00':'#FF2D55'}/>
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
  const momCol  = tech.momentum >= 70 ? '#CCFF00' : tech.momentum >= 45 ? '#FFE500' : tech.momentum >= 25 ? '#FF6B00' : '#FF2D55';

  const nearestReclaim = [
    {name:'55',val:tech.e55},{name:'90',val:tech.e90},{name:'200',val:tech.e200},
  ].filter(t=>t.val!==null&&t.val>coin.price).sort((a,b)=>a.val-b.val)[0]||null;

  const signals = [];
  if (tech.cross==='GOLDEN') signals.push({label:'GOLDEN CROSS',desc:'55 crossed above 90. Bullish flip.',color:'#CCFF00'});
  if (tech.cross==='DEATH')  signals.push({label:'DEATH CROSS',desc:'55 crossed below 90. Bearish flip.',color:'#FF2D55'});
  if (tech.rsi!==null&&tech.rsi<30) signals.push({label:'OVERSOLD',desc:'RSI under 30. Heavy selling — potential bounce zone. Confirm with structure first.',color:'#CCFF00'});
  if (tech.rsi!==null&&tech.rsi>72) signals.push({label:'OVERBOUGHT',desc:'RSI over 72. May be overextended after a run. Watch for a pullback.',color:'#FF2D55'});

  return (
    <>
      <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:900}}/>
      <div style={{
        position:'fixed',top:0,right:0,bottom:0,width:'min(500px,100vw)',
        background:'#0a0a0a',
        borderLeft:'3px solid #F5A200',
        zIndex:901,overflowY:'auto',overflowX:'hidden',
        animation:'slideIn 0.18s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* HEADER — newspaper masthead energy */}
        <div style={{position:'sticky',top:0,zIndex:10,background:'#0d0d0d'}}>
          <div style={{height:'4px',background:`linear-gradient(90deg,${color},${color}44)`}}/>
          <div style={{
            padding:'18px 20px 16px',
            borderBottom:`3px solid #fff`,
          }}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              {/* Ticker mega type */}
              <div>
                <div style={{
                  fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,
                  fontSize:'clamp(58px,12vw,82px)',
                  color:'#fff',letterSpacing:'0.01em',lineHeight:0.85,
                  textShadow:`3px 3px 0px ${color}22`,
                }}>
                  {coin.display}
                </div>
                <div style={{
                  fontFamily:'"Barlow",sans-serif',
                  fontSize:'22px',fontWeight:600,letterSpacing:'0.04em',
                  color:'#fff',lineHeight:1,marginTop:'6px',
                }}>
                  ${fmt(coin.price)}
                  <span style={{color:up?'#CCFF00':'#FF2D55',marginLeft:'14px'}}>
                    {up?'+':''}{coin.ch.toFixed(2)}%
                  </span>
                </div>
              </div>
              {/* Zone stamp */}
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'10px',paddingTop:'4px'}}>
                <div style={{
                  background:color,color:'#000',
                  fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,
                  fontSize:'11px',fontWeight:700,letterSpacing:'0.18em',
                  padding:'5px 12px',textTransform:'uppercase',
                }}>{label}</div>
                <button onClick={onClose} style={{
                  all:'unset',cursor:'pointer',
                  fontFamily:'"IBM Plex Mono",monospace',fontSize:'10px',
                  letterSpacing:'0.18em',color:'#fff',
                  textTransform:'uppercase',
                  transition:'color 0.1s',
                }}
                onMouseEnter={e=>e.currentTarget.style.color='#F5A200'}
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
              <span style={{fontFamily:'monospace',fontSize:'9px',color:'#fff',letterSpacing:'0.06em'}}>— 7 DAYS AGO</span>
              <span style={{fontFamily:'monospace',fontSize:'9px',color:'#fff',letterSpacing:'0.06em'}}>NOW —</span>
            </div>
          </div>

          {/* VERDICT — the main read, big and raw */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',marginTop:'20px',paddingTop:'20px',marginBottom:'20px'}}>
            <div style={{
              fontFamily:'"IBM Plex Mono",monospace',
              fontSize:'9px',letterSpacing:'0.35em',
              color:'#fff',marginBottom:'10px',textTransform:'uppercase',
            }}>// READ</div>
            <div style={{
              fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,
              fontSize:'clamp(24px,5vw,30px)',
              color:'#fff',lineHeight:1.05,letterSpacing:'0.01em',
              marginBottom:'12px',
            }}>
              {explain.verdict.toUpperCase()}
            </div>
            <div style={{
              fontFamily:'"Barlow",sans-serif',fontWeight:800,
              fontWeight:400,fontSize:'15px',
              color:'#fff',lineHeight:1.65,letterSpacing:'0.02em',
            }}>
              {explain.verdict}
            </div>
          </div>

          {/* WATCH */}
          <div style={{borderLeft:`4px solid ${color}`,paddingLeft:'14px',marginBottom:'24px'}}>
            <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.3em',color:color,marginBottom:'8px',textTransform:'uppercase'}}>// WATCH</div>
            <div style={{fontFamily:'"Barlow",sans-serif',fontWeight:400,fontSize:'15px',color:'#fff',lineHeight:1.6,letterSpacing:'0.02em'}}>
              {explain.watch}
            </div>
          </div>

          {/* SIGNALS — if any */}
          {signals.length > 0 && (
            <div style={{marginBottom:'24px'}}>
              {signals.map((s,i) => (
                <div key={i} style={{
                  display:'flex',gap:'14px',alignItems:'flex-start',
                  padding:'10px 0',
                  borderBottom:'1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{
                    fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,
                    fontSize:'12px',letterSpacing:'0.15em',
                    color:s.color,whiteSpace:'nowrap',paddingTop:'1px',
                    minWidth:'100px',textTransform:'uppercase',
                  }}>{s.label}</div>
                  <div style={{
                    fontFamily:'"Barlow",sans-serif',fontWeight:800,
                    fontWeight:400,fontSize:'14px',
                    color:'#fff',lineHeight:1.5,letterSpacing:'0.02em',
                  }}>{s.desc}</div>
                </div>
              ))}
            </div>
          )}

          {/* EMA LEVELS — raw data table, no decoration */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'4px'}}>
            <div style={{
              fontFamily:'"IBM Plex Mono",monospace',
              fontSize:'9px',letterSpacing:'0.35em',
              color:'#fff',marginBottom:'2px',textTransform:'uppercase',
            }}>// LEVELS</div>
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
                <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'18px',color:'#fff',letterSpacing:'0.02em'}}>EMA {name}</div>
                <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'11px',color:'#fff',fontStyle:'italic'}}>—</div>
              </div>
            );
            const p = pct(coin.price,val);
            const above = coin.price > val;
            const fill = Math.min(100,Math.max(0,((p+50)/100)*100));
            return (
              <div key={name} style={{padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'6px'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:'10px'}}>
                    <span style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'22px',color:'#fff',letterSpacing:'0.02em'}}>EMA {name}</span>
                    <span style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.14em',color:'#fff'}}>{lbl}</span>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <span style={{fontFamily:'"Barlow",sans-serif',fontSize:'15px',fontWeight:700,color:'#fff',letterSpacing:'0.04em'}}>${fmt(val)}</span>
                    <span style={{fontFamily:'"Barlow",sans-serif',fontSize:'13px',fontWeight:600,color:above?'#CCFF00':'#FF2D55',marginLeft:'10px',letterSpacing:'0.04em'}}>{above?'+':''}{p.toFixed(1)}%</span>
                  </div>
                </div>
                <div style={{height:'2px',background:'rgba(255,255,255,0.06)'}}>
                  <div style={{height:'100%',width:`${fill}%`,background:above?'#CCFF00':'#FF2D55',opacity:0.65}}/>
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
                <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.26em',color:'#fff',marginBottom:'4px',textTransform:'uppercase'}}>NEXT RECLAIM</div>
                <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'20px',color:'#fff',letterSpacing:'0.02em'}}>
                  EMA {nearestReclaim.name} · ${fmt(nearestReclaim.val)}
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'36px',color:'#FFE500',letterSpacing:'-0.01em',lineHeight:1}}>
                  {Math.abs(pct(coin.price,nearestReclaim.val)).toFixed(1)}%
                </div>
  
              </div>
            </div>
          )}

          {/* RSI — big raw number, no decoration */}
          {rsiInfo && (
            <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'0'}}>
              <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.35em',color:'#fff',marginBottom:'8px',textTransform:'uppercase'}}>// RSI</div>
              <div style={{display:'flex',alignItems:'baseline',gap:'14px',marginBottom:'10px'}}>
                <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'80px',color:'#fff',lineHeight:0.85,letterSpacing:'-0.01em'}}>{tech.rsi.toFixed(0)}</div>
                <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'18px',color:rsiInfo.color,letterSpacing:'0.08em',textTransform:'uppercase',alignSelf:'center'}}>{rsiInfo.label}</div>
              </div>
              {/* minimal bar */}
              <div style={{height:'3px',background:'rgba(255,255,255,0.07)',position:'relative',marginBottom:'6px'}}>
                <div style={{position:'absolute',left:'30%',top:'-2px',width:'2px',height:'7px',background:'rgba(204,255,0,0.3)'}}/>
                <div style={{position:'absolute',left:'70%',top:'-2px',width:'2px',height:'7px',background:'rgba(255,45,85,0.3)'}}/>
                <div style={{position:'absolute',top:'-4px',left:`${Math.min(tech.rsi,99)}%`,transform:'translateX(-50%)',width:'3px',height:'11px',background:rsiInfo.color}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'12px'}}>
                <span style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'8px',color:'rgba(204,255,0,0.4)',letterSpacing:'0.1em'}}>OVERSOLD</span>
                <span style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'8px',color:'rgba(255,45,85,0.4)',letterSpacing:'0.1em'}}>OVERBOUGHT</span>
              </div>
              <div style={{fontFamily:'"Barlow",sans-serif',fontWeight:400,fontSize:'14px',color:'#fff',lineHeight:1.6,marginBottom:'20px',letterSpacing:'0.02em'}}>{rsiInfo.text}</div>
            </div>
          )}

          {/* MOMENTUM */}
          <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginBottom:'0'}}>
            <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.35em',color:'#fff',marginBottom:'8px',textTransform:'uppercase'}}>// MOMENTUM</div>
            <div style={{display:'flex',alignItems:'baseline',gap:'14px',marginBottom:'10px'}}>
              <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'80px',color:'#fff',lineHeight:0.85,letterSpacing:'-0.01em'}}>{tech.momentum}</div>
              <div style={{fontFamily:'"Barlow Condensed",sans-serif',fontWeight:900,fontSize:'18px',color:momCol,letterSpacing:'0.08em',textTransform:'uppercase',alignSelf:'center'}}>{momInfo.label}</div>
            </div>
            <div style={{height:'3px',background:'rgba(255,255,255,0.07)',marginBottom:'12px'}}>
              <div style={{height:'100%',width:`${tech.momentum}%`,background:'#CCFF00',opacity:0.85}}/>
            </div>
            <div style={{fontFamily:'"Barlow",sans-serif',fontWeight:400,fontSize:'14px',color:'#fff',lineHeight:1.6,marginBottom:'16px',letterSpacing:'0.02em'}}>{momInfo.text}</div>
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
                  <span style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'11px',color:pass?'#CCFF00':'rgba(255,255,255,0.18)',fontWeight:700,minWidth:'12px'}}>{pass?'✓':'—'}</span>
                  <span style={{fontFamily:'"Barlow",sans-serif',fontWeight:600,fontSize:'14px',letterSpacing:'0.06em',color:pass?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.25)',textTransform:'uppercase'}}>{lbl}</span>
                </div>
                <span style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'12px',fontWeight:700,color:pass?'#CCFF00':'rgba(255,255,255,0.15)'}}>{pass?`+${pts}`:''}</span>
              </div>
            ))}
          </div>

          {/* 30D RANGE */}
          {tech.high30 && tech.low30 && (
            <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',paddingTop:'18px',marginTop:'20px'}}>
              <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.35em',color:'#fff',marginBottom:'14px',textTransform:'uppercase'}}>// 30D RANGE</div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'10px'}}>
                <div>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.2em',color:'#fff',marginBottom:'3px',textTransform:'uppercase'}}>HIGH</div>
                  <div style={{fontFamily:'"Barlow",sans-serif',fontSize:'16px',fontWeight:700,color:'#CCFF00',letterSpacing:'0.04em'}}>${fmt(tech.high30)}</div>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',color:'#fff',marginTop:'2px'}}>{pct(coin.price,tech.high30)?.toFixed(1)}% from now</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.2em',color:'#fff',marginBottom:'3px',textTransform:'uppercase'}}>NOW</div>
                  <div style={{fontFamily:'"Barlow",sans-serif',fontSize:'16px',fontWeight:700,color:'#fff',letterSpacing:'0.04em'}}>${fmt(coin.price)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',letterSpacing:'0.2em',color:'#fff',marginBottom:'3px',textTransform:'uppercase'}}>LOW</div>
                  <div style={{fontFamily:'"Barlow",sans-serif',fontSize:'16px',fontWeight:700,color:'#FF2D55',letterSpacing:'0.04em'}}>${fmt(tech.low30)}</div>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',color:'#fff',marginTop:'2px'}}>+{Math.abs(pct(coin.price,tech.low30))?.toFixed(1)}% above</div>
                </div>
              </div>
              {tech.high30!==tech.low30 && (
                <>
                  <div style={{height:'2px',background:'rgba(255,255,255,0.07)',position:'relative',marginBottom:'6px'}}>
                    <div style={{position:'absolute',top:'-4px',left:`${((coin.price-tech.low30)/(tech.high30-tech.low30))*100}%`,transform:'translateX(-50%)',width:'2px',height:'10px',background:'#fff'}}/>
                  </div>
                  <div style={{fontFamily:'"IBM Plex Mono",monospace',fontSize:'9px',color:'#fff',textAlign:'center',letterSpacing:'0.08em'}}>
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
  <div style={{ height:'300px', background:'#0d0d0d', border:'1px solid rgba(245,162,0,0.12)', overflow:'hidden', position:'relative' }}>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:'3px', background:'rgba(245,162,0,0.15)' }} />
    <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg,transparent,rgba(245,162,0,0.03),transparent)', animation:'sweep 1.8s ease-in-out infinite' }} />
    <div style={{ position:'absolute', top:'16px', left:'14px', fontFamily:'"IBM Plex Mono",monospace', fontSize:'8px', color:'rgba(245,162,0,0.2)', letterSpacing:'0.2em' }}>LOADING_</div>
  </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// CARD
// ═══════════════════════════════════════════════════════════════════════════════

const Card = ({ coin, tech, pinned, onClick }) => {
  const zone = getZone(coin.price, tech.e55, tech.e90, tech.e200);
  const { label, color } = Z[zone];
  const up = coin.ch >= 0;
  const momCol = tech.momentum>=70?'#CCFF00':tech.momentum>=45?'#F5A200':tech.momentum>=25?'#FFE500':'#FF2D55';

  const signals = [];
  if (tech.cross==='GOLDEN') signals.push({ label:'GOLDEN X', color:'#CCFF00' });
  if (tech.cross==='DEATH')  signals.push({ label:'DEATH X',  color:'#FF2D55' });
  if (tech.rsi!==null&&tech.rsi<30)  signals.push({ label:'OVERSOLD',   color:'#CCFF00' });
  if (tech.rsi!==null&&tech.rsi>72)  signals.push({ label:'OVERBOUGHT', color:'#FF2D55' });

  const nearestReclaim = useMemo(() => {
    return [
      {name:'55',val:tech.e55},{name:'90',val:tech.e90},{name:'200',val:tech.e200}
    ].filter(t=>t.val&&t.val>coin.price).sort((a,b)=>a.val-b.val)[0]||null;
  }, [tech, coin.price]);

  return (
    <div onClick={onClick} style={{
      background:'#0d0d0d',
      border:`1px solid ${color}35`,
      cursor:'pointer',
      transition:'border-color 0.12s, transform 0.1s',
      position:'relative', overflow:'hidden',
    }}
    onMouseEnter={e=>{ e.currentTarget.style.borderColor=color+'80'; e.currentTarget.style.transform='translateY(-2px)'; }}
    onMouseLeave={e=>{ e.currentTarget.style.borderColor=color+'35'; e.currentTarget.style.transform='none'; }}
    >
      {/* Top accent — zone color */}
      <div style={{ height:'3px', background:color }} />

      <div style={{ padding:'12px 14px 14px' }}>

        {/* Header: ticker + price */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'26px', color:'#fff', letterSpacing:'0.02em', lineHeight:1 }}>{coin.display}</span>
              {pinned && <span style={{ fontFamily:MONO, fontSize:'7px', color:'#F5A200', padding:'1px 4px', border:'1px solid rgba(245,162,0,0.4)', letterSpacing:'0.1em' }}>PIN</span>}
              {coin.source==='bybit'  && <span style={{ fontFamily:MONO, fontSize:'7px', color:'#00C8FF', padding:'1px 4px', border:'1px solid rgba(0,200,255,0.4)', letterSpacing:'0.1em' }}>BT</span>}
              {coin.source==='kraken' && <span style={{ fontFamily:MONO, fontSize:'7px', color:'#9B59FF', padding:'1px 4px', border:'1px solid rgba(155,89,255,0.4)', letterSpacing:'0.1em' }}>KR</span>}
            </div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'3px', letterSpacing:'0.06em' }}>${(coin.vol/1e6).toFixed(0)}M vol</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:MONO, fontSize:'13px', fontWeight:700, color:'#fff' }}>${fmt(coin.price)}</div>
            <div style={{ fontFamily:MONO, fontSize:'10px', fontWeight:700, color:up?'#CCFF00':'#FF2D55', marginTop:'2px' }}>{up?'+':''}{coin.ch.toFixed(2)}%</div>
          </div>
        </div>

        {/* Spark + momentum */}
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'10px' }}>
          <Spark data={tech.spark} />
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
              <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.1em' }}>SCORE</span>
              {tech.atr && <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff' }}>±{fmt(tech.atr)}</span>}
            </div>
            <MomentumBar score={tech.momentum} />
          </div>
        </div>

        {/* Signals */}
        {signals.length>0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:'3px', marginBottom:'8px' }}>
            {signals.map((s,i)=><SignalTag key={i} label={s.label} color={s.color}/>)}
          </div>
        )}

        {/* EMA levels */}
        <div style={{ marginBottom:'8px', background:'rgba(0,0,0,0.3)', padding:'6px 8px' }}>
          <EmaRow label="55"  val={tech.e55}  price={coin.price}/>
          <EmaRow label="90"  val={tech.e90}  price={coin.price}/>
          <EmaRow label="200" val={tech.e200} price={coin.price}/>
        </div>

        {/* RSI */}
        {tech.rsi!==null && (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
            <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.12em' }}>RSI</span>
            <div style={{ flex:1, height:'3px', background:'rgba(255,255,255,0.06)', position:'relative' }}>
              <div style={{ position:'absolute', left:'30%', top:0, height:'100%', width:'1px', background:'rgba(204,255,0,0.2)'}}/>
              <div style={{ position:'absolute', left:'70%', top:0, height:'100%', width:'1px', background:'rgba(255,45,85,0.2)'}}/>
              <div style={{ position:'absolute', top:'-3px', left:`${Math.min(tech.rsi,99)}%`, transform:'translateX(-50%)', width:'3px', height:'9px', background:tech.rsi>70?'#FF2D55':tech.rsi<30?'#CCFF00':'rgba(255,255,255,0.5)' }}/>
            </div>
            <span style={{ fontFamily:MONO, fontSize:'10px', fontWeight:700, color:tech.rsi>70?'#FF2D55':tech.rsi<30?'#CCFF00':'#fff' }}>{tech.rsi.toFixed(0)}</span>
          </div>
        )}

        {/* Reclaim target */}
        {nearestReclaim && (
          <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 8px', border:'1px solid rgba(245,162,0,0.2)', background:'rgba(245,162,0,0.04)', marginBottom:'8px' }}>
            <span style={{ fontFamily:MONO, fontSize:'8px', color:'rgba(245,162,0,0.6)', letterSpacing:'0.1em' }}>[RECLAIM_E{nearestReclaim.name}]</span>
            <div style={{ display:'flex', gap:'8px' }}>
              <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff' }}>${fmt(nearestReclaim.val)}</span>
              <span style={{ fontFamily:MONO, fontSize:'8px', fontWeight:700, color:'#F5A200' }}>{Math.abs(pct(coin.price,nearestReclaim.val)).toFixed(1)}%</span>
            </div>
          </div>
        )}

        {/* Zone stamp */}
        <div style={{
          padding:'5px 0', textAlign:'center',
          background: zone==='FULL_BULL' ? color : 'transparent',
          border: zone==='FULL_BULL' ? 'none' : `1px solid ${color}40`,
          color: zone==='FULL_BULL' ? '#000' : color,
          fontFamily:MONO, fontSize:'9px', fontWeight:700, letterSpacing:'0.22em',
        }}>
          [{label.replace(' ','_')}_]
        </div>
      </div>
    </div>
  );
};
// Filter pill — bracket style
const Pill = ({ label, color, count, active, onClick }) => (
  <button onClick={onClick} style={{
    all:'unset', cursor:'pointer',
    display:'inline-flex', alignItems:'center', gap:'4px',
    padding:'4px 10px',
    border:`1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
    background: active ? color : 'transparent',
    fontFamily:MONO, fontWeight:700,
    fontSize:'8px', letterSpacing:'0.14em',
    color: active ? '#0a0a0a' : 'rgba(255,255,255,0.4)',
    transition:'all 0.1s', whiteSpace:'nowrap',
    textTransform:'uppercase',
  }}>
    {active ? '' : '['}{label}{active ? '' : '_]'}
    <span style={{ fontSize:'8px', color: active ? '#0a0a0a' : 'rgba(255,255,255,0.3)', fontWeight:700, opacity:0.8 }}>{count}</span>
  </button>
);

// ═══════════════════════════════════════════════════════════════════════════════
// LABS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const MONO = '"IBM Plex Mono",monospace';
const COND = '"Barlow Condensed",sans-serif';
const OR = '#F5A200';   // orange — primary accent
const GR = '#CCFF00';   // green  — bull signals
const RD = '#FF2D55';   // red    — bear signals

const SECTORS = {
  'Layer 1':   ['BTCUSDT','ETHUSDT','SOLUSDT','APTUSDT','SUIUSDT','AVAXUSDT','ADAUSDT','DOTUSDT','NEARUSDT','ATOMUSDT','TONUSDT','ALGOUSDT','ICPUSDT','TIAUSDT'],
  'Layer 2':   ['MATICUSDT','ARBUSDT','OPUSDT','STRKUSDT','MANTAUSDT','SCROLLUSDT','ZKUSDT'],
  'DeFi':      ['UNIUSDT','AAVEUSDT','CRVUSDT','MKRUSDT','SNXUSDT','COMPUSDT','LRCUSDT','DYDXUSDT','GMXUSDT','INJUSDT'],
  'AI & Data': ['FETUSDT','AGIXUSDT','RENDERUSDT','WLDUSDT','TAOUSDT','AIUSDT','GRTUSDT'],
  'Gaming':    ['AXSUSDT','SANDUSDT','MANAUSDT','GALUSDT','IMXUSDT','RONUSDT','BEAMUSDT'],
  'Meme':      ['DOGEUSDT','SHIBUSDT','PEPEUSDT','FLOKIUSDT','BONKUSDT','WIFUSDT'],
};

// Bracket-style label — like [LAUNCH TERMINAL_]
const Brkt = ({ children, color=OR }) => (
  <span style={{ fontFamily:MONO, fontSize:'10px', fontWeight:700, color, letterSpacing:'0.12em' }}>
    [{children}_]
  </span>
);

// Section header — thick orange bar left, big white label
const SectionHead = ({ num, title, sub }) => (
  <div style={{ display:'flex', alignItems:'stretch', gap:'0', marginBottom:'28px' }}>
    <div style={{ width:'6px', background:OR, flexShrink:0 }} />
    <div style={{ flex:1, borderTop:`3px solid ${OR}`, borderBottom:'1px solid rgba(255,255,255,0.06)', padding:'10px 16px' }}>
      <div style={{ fontFamily:MONO, fontSize:'8px', color:OR, letterSpacing:'0.3em', marginBottom:'3px' }}>{num}</div>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(26px,4vw,38px)', color:'#fff', letterSpacing:'0.04em', textTransform:'uppercase', lineHeight:1 }}>{title}</div>
      {sub && <div style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', marginTop:'4px', letterSpacing:'0.08em' }}>{sub}</div>}
    </div>
  </div>
);

// Plain-english explainer line
const Explain = ({ children }) => (
  <div style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', lineHeight:1.8, letterSpacing:'0.04em', borderLeft:`2px solid ${OR}40`, paddingLeft:'12px', marginBottom:'24px' }}>
    {children}
  </div>
);

// ── 01: MARKET PULSE ─────────────────────────────────────────────────────────
const MarketPulse = ({ coins, techMap }) => {
  const s = useMemo(() => {
    const list = coins.filter(c => techMap[c.symbol]);
    const n = list.length; if (!n) return null;
    const green  = list.filter(c=>c.ch>0).length;
    const red    = list.filter(c=>c.ch<0).length;
    const rip    = list.filter(c=>c.ch>10).length;
    const dump   = list.filter(c=>c.ch<-10).length;
    const avgCh  = list.reduce((s,c)=>s+c.ch,0)/n;
    const fb     = list.filter(c=>{ const t=techMap[c.symbol]; return t&&getZone(c.price,t.e55,t.e90,t.e200)==='FULL_BULL'; }).length;
    const bear   = list.filter(c=>{ const t=techMap[c.symbol]; return t&&['BEAR_FULL','BEAR_WATCH'].includes(getZone(c.price,t.e55,t.e90,t.e200)); }).length;
    const winner = [...list].sort((a,b)=>b.ch-a.ch)[0];
    const loser  = [...list].sort((a,b)=>a.ch-b.ch)[0];
    return { n, green, red, rip, dump, avgCh, fb, bear, winner, loser };
  }, [coins, techMap]);
  if (!s) return null;

  const mood = s.avgCh>3?{w:'GREED',c:GR} : s.avgCh>0?{w:'OPTIMISM',c:OR} : s.avgCh>-3?{w:'CAUTION',c:'#FFE500'} : {w:'FEAR',c:RD};

  return (
    <div style={{ padding:'32px 28px', borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
      <SectionHead num="ALPHA_SECTOR_01" title="Market Pulse" sub="Where the market stands right now — no fluff" />

      {/* Giant mood word — this IS the statement */}
      <div style={{ marginBottom:'8px' }}>
        <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(72px,14vw,160px)', color:mood.c, lineHeight:0.85, letterSpacing:'-0.02em', textTransform:'uppercase', textShadow:`0 0 60px ${mood.c}33` }}>
          {mood.w}
        </div>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:'#fff', marginTop:'8px', letterSpacing:'0.14em' }}>
          AVG MOVE: <span style={{ color:s.avgCh>=0?GR:RD, fontWeight:700 }}>{s.avgCh>=0?'+':''}{s.avgCh.toFixed(2)}%</span> &nbsp;·&nbsp; {s.n} COINS TRACKED
        </div>
      </div>

      <Explain>
        {s.green} coins are up. {s.red} are down.{s.rip>0?` ${s.rip} ripping more than +10% — something big is moving.`:''}
        {s.dump>0?` ${s.dump} getting destroyed past -10% — there's blood out there.`:''}
        {' '}{s.fb} coins in a full bull trend. {s.bear} in full bear. That's the real split.
      </Explain>

      {/* Stat grid — no cards, just raw bordered boxes */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'0', borderTop:`2px solid ${OR}`, borderLeft:`2px solid ${OR}` }}>
        {[
          {n:s.green,  label:'UP TODAY',    c:GR},
          {n:s.red,    label:'DOWN TODAY',  c:RD},
          {n:s.fb,     label:'FULL BULL',   c:GR},
          {n:s.bear,   label:'BEAR ZONE',   c:'#CC2200'},
          {n:s.rip,    label:'+10% RIP',    c:OR},
          {n:s.dump,   label:'-10% DUMP',   c:RD},
        ].map(({n,label,c})=>(
          <div key={label} style={{ padding:'16px 20px', borderRight:`2px solid ${OR}`, borderBottom:`2px solid ${OR}`, minWidth:'90px', flex:'1' }}>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'48px', color:c, lineHeight:1, letterSpacing:'-0.02em' }}>{n}</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.16em', marginTop:'4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Top mover callouts */}
      <div style={{ display:'flex', gap:'2px', marginTop:'16px', flexWrap:'wrap' }}>
        {s.winner && (
          <div style={{ flex:1, minWidth:'180px', padding:'14px 16px', background:'#111', borderLeft:`4px solid ${GR}` }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.2em', marginBottom:'6px' }}>[ BIGGEST WINNER_ ]</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'36px', color:'#fff', lineHeight:1 }}>{s.winner.display}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:GR }}>+{s.winner.ch.toFixed(2)}%</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'4px', lineHeight:1.6 }}>Up the most today. Doesn't mean buy — but something happened here.</div>
          </div>
        )}
        {s.loser && (
          <div style={{ flex:1, minWidth:'180px', padding:'14px 16px', background:'#111', borderLeft:`4px solid ${RD}` }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.2em', marginBottom:'6px' }}>[ BIGGEST LOSER_ ]</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'36px', color:'#fff', lineHeight:1 }}>{s.loser.display}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:RD }}>{s.loser.ch.toFixed(2)}%</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'4px', lineHeight:1.6 }}>Down the most. Could be news, an exit, or just weakness bleeding out.</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── 02: MOMENTUM LEADERBOARD ─────────────────────────────────────────────────
const MomentumBoard = ({ coins, techMap }) => {
  const list = useMemo(() =>
    coins.filter(c=>techMap[c.symbol]&&techMap[c.symbol].momentum!==undefined)
         .sort((a,b)=>(techMap[b.symbol].momentum||0)-(techMap[a.symbol].momentum||0))
  , [coins, techMap]);

  return (
    <div style={{ padding:'32px 28px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
      <SectionHead num="ALPHA_SECTOR_02" title="Momentum Score" sub="0–100. Higher = stronger trend. Lower = structure is broken." />
      <Explain>
        Each coin gets scored on: is it above its key moving averages? Are those averages in the right order? Is buying pressure strong? 100 = perfect setup. 0 = everything is falling apart. Use this to find coins with real structure — not just Twitter hype.
      </Explain>

      {/* Top 15 */}
      <div style={{ marginBottom:'24px' }}>
        <div style={{ fontFamily:MONO, fontSize:'8px', color:OR, letterSpacing:'0.24em', marginBottom:'12px', textTransform:'uppercase' }}>[ TOP_PERFORMERS_ ]</div>
        {list.slice(0,15).map((coin,i) => {
          const t = techMap[coin.symbol];
          const c = t.momentum>=70?GR:t.momentum>=45?OR:t.momentum>=25?'#FFE500':RD;
          return (
            <div key={coin.symbol} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', width:'24px', flexShrink:0 }}>#{i+1}</span>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff', width:'74px', flexShrink:0, letterSpacing:'0.02em' }}>{coin.display}</span>
              <div style={{ flex:1, height:'5px', background:'rgba(255,255,255,0.05)' }}>
                <div style={{ height:'100%', width:`${t.momentum}%`, background:c }} />
              </div>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'24px', color:c, width:'48px', textAlign:'right', letterSpacing:'-0.01em' }}>{t.momentum}</span>
              <span style={{ fontFamily:MONO, fontSize:'9px', color:coin.ch>=0?GR:RD, width:'52px', textAlign:'right', flexShrink:0 }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>

      {/* Bottom 8 danger zone */}
      <div style={{ background:'#0f0f0f', border:`1px solid ${RD}30`, padding:'16px' }}>
        <div style={{ fontFamily:MONO, fontSize:'8px', color:RD, letterSpacing:'0.24em', marginBottom:'12px' }}>[ DANGER_ZONE_ ] — WEAKEST STRUCTURE RIGHT NOW</div>
        <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginBottom:'12px', lineHeight:1.6 }}>
          Avoid these unless you're hunting a reversal. Everything is broken or breaking.
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
          {list.slice(-8).reverse().map(coin => {
            const t = techMap[coin.symbol];
            return (
              <div key={coin.symbol} style={{ padding:'6px 12px', border:`1px solid ${RD}30`, background:`${RD}08` }}>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff' }}>{coin.display} </span>
                <span style={{ fontFamily:MONO, fontSize:'9px', color:RD }}>{t.momentum}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── 03: RSI EXTREMES ─────────────────────────────────────────────────────────
const RsiSection = ({ coins, techMap }) => {
  const { ob, os } = useMemo(() => {
    const list = coins.filter(c=>techMap[c.symbol]&&techMap[c.symbol].rsi!==null);
    return {
      ob: list.filter(c=>techMap[c.symbol].rsi>70).sort((a,b)=>techMap[b.symbol].rsi-techMap[a.symbol].rsi).slice(0,10),
      os: list.filter(c=>techMap[c.symbol].rsi<30).sort((a,b)=>techMap[a.symbol].rsi-techMap[b.symbol].rsi).slice(0,10),
    };
  }, [coins, techMap]);

  return (
    <div style={{ padding:'32px 28px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
      <SectionHead num="ALPHA_SECTOR_03" title="RSI Extremes" sub="Who's been bought too hard — and who's been sold into the floor." />
      <Explain>
        RSI measures speed and size of recent price moves. Under 30 = coin has been sold so hard it might snap back. Over 70 = coin has been chased so high it might pull back. Neither is a guaranteed trade — always check the bigger trend first.
      </Explain>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
        <div>
          <div style={{ padding:'10px 14px', borderTop:`3px solid ${GR}`, background:`${GR}0a`, marginBottom:'2px' }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:GR, letterSpacing:'0.2em', marginBottom:'2px' }}>[ OVERSOLD_ ] RSI UNDER 30</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', lineHeight:1.5 }}>Beaten down. Potential bounce zone — but confirm with structure first.</div>
          </div>
          {os.length===0 && <div style={{ padding:'16px 14px', fontFamily:MONO, fontSize:'9px', color:'#fff' }}>None right now.</div>}
          {os.map(coin => (
            <div key={coin.symbol} style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0d0d0d' }}>
              <div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff', letterSpacing:'0.02em' }}>{coin.display}</div>
                <div style={{ fontFamily:MONO, fontSize:'8px', color:coin.ch>=0?GR:RD }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(1)}% today</div>
              </div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:GR, letterSpacing:'-0.02em' }}>{techMap[coin.symbol].rsi.toFixed(0)}</div>
            </div>
          ))}
        </div>
        <div>
          <div style={{ padding:'10px 14px', borderTop:`3px solid ${RD}`, background:`${RD}0a`, marginBottom:'2px' }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:RD, letterSpacing:'0.2em', marginBottom:'2px' }}>[ OVERBOUGHT_ ] RSI OVER 70</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', lineHeight:1.5 }}>Chased up too fast. Could pull back hard. Don't buy the peak.</div>
          </div>
          {ob.length===0 && <div style={{ padding:'16px 14px', fontFamily:MONO, fontSize:'9px', color:'#fff' }}>None right now.</div>}
          {ob.map(coin => (
            <div key={coin.symbol} style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#0d0d0d' }}>
              <div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff', letterSpacing:'0.02em' }}>{coin.display}</div>
                <div style={{ fontFamily:MONO, fontSize:'8px', color:coin.ch>=0?GR:RD }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(1)}% today</div>
              </div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:RD, letterSpacing:'-0.02em' }}>{techMap[coin.symbol].rsi.toFixed(0)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── 04: CROSSOVER RADAR ───────────────────────────────────────────────────────
const CrossSection = ({ coins, techMap }) => {
  const { golden, death } = useMemo(() => {
    const list = coins.filter(c=>techMap[c.symbol]&&techMap[c.symbol].cross);
    return { golden:list.filter(c=>techMap[c.symbol].cross==='GOLDEN'), death:list.filter(c=>techMap[c.symbol].cross==='DEATH') };
  }, [coins, techMap]);

  return (
    <div style={{ padding:'32px 28px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
      <SectionHead num="ALPHA_SECTOR_04" title="Crossover Radar" sub="Trend flips detected in the last 5 days." />
      <Explain>
        When EMA 55 crosses above EMA 90 = golden cross. Short-term trend is flipping bullish. When it crosses below = death cross. Bearish flip. These are some of the most-watched signals in crypto. Fresh crossovers = early in a new move.
      </Explain>

      {!golden.length && !death.length && (
        <div style={{ padding:'24px 20px', border:`1px solid rgba(255,255,255,0.06)`, background:'#0d0d0d' }}>
          <div style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', letterSpacing:'0.12em' }}>[ NO_CROSSOVERS_DETECTED_ ] — Market holding. No major trend flips in the last 5 days.</div>
        </div>
      )}

      {golden.length > 0 && (
        <div style={{ marginBottom:'16px' }}>
          <div style={{ fontFamily:MONO, fontSize:'8px', color:GR, letterSpacing:'0.24em', marginBottom:'10px', paddingBottom:'8px', borderBottom:`2px solid ${GR}` }}>
            [ GOLDEN_CROSS_ ] — EMA 55 CROSSED ABOVE EMA 90 — BULLISH FLIP ({golden.length})
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'2px' }}>
            {golden.map(coin => {
              const t = techMap[coin.symbol];
              return (
                <div key={coin.symbol} style={{ padding:'14px 16px', borderLeft:`4px solid ${GR}`, background:`${GR}08`, flex:'1', minWidth:'150px' }}>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'26px', color:'#fff' }}>{coin.display}</div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:GR, marginBottom:'6px' }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(2)}% today</div>
                  <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', lineHeight:1.6 }}>
                    {t.e55&&`E55 $${fmt(t.e55)}`}{t.e90&&` · E90 $${fmt(t.e90)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {death.length > 0 && (
        <div>
          <div style={{ fontFamily:MONO, fontSize:'8px', color:RD, letterSpacing:'0.24em', marginBottom:'10px', paddingBottom:'8px', borderBottom:`2px solid ${RD}` }}>
            [ DEATH_CROSS_ ] — EMA 55 CROSSED BELOW EMA 90 — BEARISH FLIP ({death.length})
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'2px' }}>
            {death.map(coin => {
              const t = techMap[coin.symbol];
              return (
                <div key={coin.symbol} style={{ padding:'14px 16px', borderLeft:`4px solid ${RD}`, background:`${RD}08`, flex:'1', minWidth:'150px' }}>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'26px', color:'#fff' }}>{coin.display}</div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:RD, marginBottom:'6px' }}>{coin.ch.toFixed(2)}% today</div>
                  <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', lineHeight:1.6 }}>
                    {t.e55&&`E55 $${fmt(t.e55)}`}{t.e90&&` · E90 $${fmt(t.e90)}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ── 05: SECTOR ROTATION ───────────────────────────────────────────────────────
const SectorSection = ({ coins, techMap }) => {
  const data = useMemo(() => {
    return Object.entries(SECTORS).map(([sector, syms]) => {
      const matched = coins.filter(c=>syms.includes(c.symbol)&&techMap[c.symbol]);
      if (!matched.length) return null;
      const avgCh  = matched.reduce((s,c)=>s+c.ch,0)/matched.length;
      const avgMom = matched.reduce((s,c)=>s+(techMap[c.symbol].momentum||0),0)/matched.length;
      const bullCt = matched.filter(c=>{ const t=techMap[c.symbol]; return c.price>t.e55&&c.price>t.e90; }).length;
      return { sector, count:matched.length, avgCh, avgMom:Math.round(avgMom), bullPct:Math.round(bullCt/matched.length*100) };
    }).filter(Boolean).sort((a,b)=>b.avgCh-a.avgCh);
  }, [coins, techMap]);

  return (
    <div style={{ padding:'32px 28px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
      <SectionHead num="ALPHA_SECTOR_05" title="Sector Rotation" sub="Where the money is flowing right now." />
      <Explain>
        Crypto doesn't pump all at once. Money rotates — Layer 1s run first, then DeFi catches up, then AI coins, then memes pop at the end. Knowing which sector is leading tells you where the next move might come from.
      </Explain>

      {data[0] && data[data.length-1] && (
        <div style={{ display:'flex', gap:'2px', marginBottom:'20px', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:'180px', padding:'16px', background:'#0f0f0f', borderTop:`3px solid ${GR}` }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.2em', marginBottom:'6px' }}>[ HOTTEST_SECTOR_ ]</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', lineHeight:1 }}>{data[0].sector.toUpperCase()}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:GR }}>+{data[0].avgCh.toFixed(1)}% avg · score {data[0].avgMom}</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'4px' }}>{data[0].bullPct}% of coins above key EMAs</div>
          </div>
          <div style={{ flex:1, minWidth:'180px', padding:'16px', background:'#0f0f0f', borderTop:`3px solid ${RD}` }}>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.2em', marginBottom:'6px' }}>[ COLDEST_SECTOR_ ]</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', lineHeight:1 }}>{data[data.length-1].sector.toUpperCase()}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:RD }}>{data[data.length-1].avgCh.toFixed(1)}% avg · score {data[data.length-1].avgMom}</div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'4px' }}>{data[data.length-1].bullPct}% of coins above key EMAs</div>
          </div>
        </div>
      )}

      {data.map((d,i) => {
        const c = d.avgCh>=3?GR:d.avgCh>=0?OR:d.avgCh>=-3?'#FFE500':RD;
        return (
          <div key={d.sector} style={{ display:'flex', alignItems:'center', gap:'14px', padding:'9px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', width:'18px' }}>{i+1}</span>
            <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:'#fff', letterSpacing:'0.04em', textTransform:'uppercase', width:'90px' }}>{d.sector}</span>
            <div style={{ flex:1, height:'4px', background:'rgba(255,255,255,0.05)' }}>
              <div style={{ height:'100%', width:`${d.avgMom}%`, background:c }} />
            </div>
            <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:c, width:'58px', textAlign:'right' }}>{d.avgCh>=0?'+':''}{d.avgCh.toFixed(1)}%</span>
            <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', width:'36px', textAlign:'right' }}>{d.count}c</span>
          </div>
        );
      })}
    </div>
  );
};

// ── 06: VOLUME DOMINANCE ──────────────────────────────────────────────────────
const VolumeSection = ({ coins, techMap }) => {
  const data = useMemo(() => {
    const total = coins.reduce((s,c)=>s+c.vol,0);
    return coins.filter(c=>techMap[c.symbol]).sort((a,b)=>b.vol-a.vol).slice(0,12)
      .map(c=>({ sym:c.display, pct:(c.vol/total)*100, vol:c.vol, ch:c.ch }));
  }, [coins, techMap]);

  return (
    <div style={{ padding:'32px 28px', paddingBottom:'60px' }}>
      <SectionHead num="ALPHA_SECTOR_06" title="Volume Dominance" sub="Who's eating the most trading volume right now." />
      <Explain>
        Volume = real money moving. When a coin grabs way more volume than normal, big players are active — institutions, whales, funds. That's where the real action is, not where the tweets are loudest.
      </Explain>

      {data[0] && (
        <div style={{ marginBottom:'20px', padding:'16px 20px', background:'#0f0f0f', borderLeft:`6px solid ${OR}` }}>
          <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.2em', marginBottom:'4px' }}>[ VOLUME_KING_ ]</div>
          <div style={{ display:'flex', alignItems:'baseline', gap:'16px', flexWrap:'wrap' }}>
            <span style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(48px,8vw,80px)', color:'#fff', lineHeight:1, letterSpacing:'-0.01em' }}>{data[0].sym}</span>
            <span style={{ fontFamily:COND, fontWeight:900, fontSize:'36px', color:OR }}>{data[0].pct.toFixed(1)}%</span>
            <span style={{ fontFamily:MONO, fontSize:'11px', color:'#fff' }}>${(data[0].vol/1e9).toFixed(2)}B</span>
          </div>
          <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', marginTop:'6px', lineHeight:1.6 }}>
            Controls {data[0].pct.toFixed(1)}% of all tracked volume. That's {data[0].ch>=0?'bullish':'bearish'} dominance — price is {data[0].ch>=0?'up':''}{data[0].ch.toFixed(2)}%.
          </div>
        </div>
      )}

      {data.slice(1).map((d,i) => (
        <div key={d.sym} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', width:'22px' }}>#{i+2}</span>
          <span style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:'#fff', width:'68px', letterSpacing:'0.02em' }}>{d.sym}</span>
          <div style={{ flex:1, height:'3px', background:'rgba(255,255,255,0.05)' }}>
            <div style={{ height:'100%', width:`${(d.pct/data[0].pct)*100}%`, background:d.ch>=0?`${GR}88`:`${RD}88` }} />
          </div>
          <span style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', width:'38px', textAlign:'right' }}>{d.pct.toFixed(1)}%</span>
          <span style={{ fontFamily:MONO, fontSize:'9px', color:d.ch>=0?GR:RD, width:'52px', textAlign:'right' }}>{d.ch>=0?'+':''}{d.ch.toFixed(1)}%</span>
          <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', width:'52px', textAlign:'right' }}>${(d.vol/1e6).toFixed(0)}M</span>
        </div>
      ))}
    </div>
  );
};

// ── LABS ROOT ─────────────────────────────────────────────────────────────────
const LabsPage = ({ techMap, coins }) => {
  const ready = Object.keys(techMap).length > 30;

  if (!ready) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(60px,12vw,140px)', color:'rgba(255,255,255,0.05)', letterSpacing:'-0.02em', lineHeight:1 }}>LABS</div>
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <div style={{ width:'8px', height:'8px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:MONO, fontSize:'10px', color:OR, letterSpacing:'0.2em', textTransform:'uppercase' }}>LOADING_DATA — Go to Scanner first. Tools activate automatically.</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>
      {/* Masthead — like the image reference */}
      <div style={{ padding:'28px 28px 24px', borderBottom:`3px solid ${OR}`, background:'#0a0a0a' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:OR, letterSpacing:'0.4em', marginBottom:'4px' }}>// ADVANCED TOOLS — PLAIN ENGLISH EDITION</div>
            <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(56px,11vw,120px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em', textTransform:'uppercase' }}>
              ALPHA<br/>
              <span style={{ color:OR }}>SECTOR</span>
            </h1>
          </div>
          <div style={{ fontFamily:MONO, fontSize:'9px', color:'#fff', textAlign:'right', lineHeight:2, letterSpacing:'0.1em', textTransform:'uppercase' }}>
            <div style={{ color:OR }}>SYSTEM ACTIVE_</div>
            <div>{coins.filter(c=>techMap[c.symbol]).length} COINS LOADED</div>
            <div>BINANCE · LIVE DATA</div>
            <div>NOT FINANCIAL ADVICE</div>
          </div>
        </div>
      </div>

      <MarketPulse coins={coins} techMap={techMap} />
      <MomentumBoard coins={coins} techMap={techMap} />
      <RsiSection coins={coins} techMap={techMap} />
      <CrossSection coins={coins} techMap={techMap} />
      <SectorSection coins={coins} techMap={techMap} />
      <VolumeSection coins={coins} techMap={techMap} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// WAR ROOM
// ═══════════════════════════════════════════════════════════════════════════════

// Classify every coin into one of 6 battlefield verdicts
const classify = (coin, tech) => {
  if (!tech) return null;
  const { e55, e90, e200, rsi, momentum, cross } = tech;
  const price = coin.price;
  const ch = coin.ch;
  const zone = getZone(price, e55, e90, e200);
  const aboveAll  = price>e55 && price>e90 && price>e200;
  const belowAll  = e55&&e90&&e200 && price<e55 && price<e90 && price<e200;
  const stackedUp = e55&&e90&&e200 && e55>e90 && e90>e200;
  const nearE55   = e55 && Math.abs(pct(price,e55)) < 4;
  const nearE200  = e200 && Math.abs(pct(price,e200)) < 5;
  const rsiOS     = rsi !== null && rsi < 32;
  const rsiOB     = rsi !== null && rsi > 70;
  const goldenX   = cross === 'GOLDEN';
  const deathX    = cross === 'DEATH';
  const bigDump   = ch < -8;
  const bigRip    = ch > 8;

  // LOCKED IN — everything aligned, trend healthy, just run with it
  if (aboveAll && stackedUp && momentum >= 65 && !rsiOB)
    return { verdict:'LOCKED IN', color:'#CCFF00', short:'Clean trend. Everything stacked. This is what you want.' };

  // ABOUT TO MOVE — coiling near key level, cross incoming or fresh
  if ((goldenX || (nearE55 && zone==='COILING') || (momentum>=50&&nearE200&&aboveAll)) && !belowAll)
    return { verdict:'ABOUT TO MOVE', color:'#F5A200', short: goldenX ? 'Golden cross just fired. Short-term trend flipping up.' : 'Compressing near a key EMA. The spring is coiling.' };

  // OVERBOUGHT RISK — ripping hard, RSI dangerously hot
  if (rsiOB && bigRip && momentum >= 60)
    return { verdict:'OVERBOUGHT', color:'#FFE500', short:'Being chased hard. RSI is redlining. Could keep going — or snap back.' };

  // DEAD CAT — bouncing after a dump, but structure still broken
  if (belowAll && ch > 3 && rsi && rsi < 50 && momentum < 40)
    return { verdict:'DEAD CAT?', color:'#FF6B00', short:'Bouncing off lows but the trend is still broken. Could be a trap.' };

  // ABOUT TO BREAK — below all EMAs, death cross or bleeding, final support zone
  if ((deathX || (belowAll && ch < -3)) && momentum < 35)
    return { verdict:'BREAKING DOWN', color:'#FF2D55', short: deathX ? 'Death cross confirmed. Trend officially flipped bearish.' : 'Lost all key levels. Sellers are in full control.' };

  // OVERSOLD WATCH — beaten down hard, RSI in extreme territory
  if (rsiOS && belowAll && momentum < 30)
    return { verdict:'OVERSOLD WATCH', color:'#CCFF00', short:'Sold into the floor. Could snap back violently — but confirm structure first.' };

  // COILING — above some EMAs, stuck in range
  if (zone === 'COILING' || zone === 'RECOVERY')
    return { verdict:'IN NO MAN\'S LAND', color:'#F5A200', short:'Above 200 but lost the short-term EMAs. Either reclaims or breaks down.' };

  // Default — bear zone, no specific signal
  if (belowAll)
    return { verdict:'AVOID', color:'#CC2200', short:'Below all key levels. No reason to be here until structure returns.' };

  return { verdict:'NEUTRAL', color:'#fff', short:'No clear edge in either direction right now.' };
};

const VERDICT_ORDER = ['LOCKED IN','ABOUT TO MOVE','ABOUT TO BREAK','OVERBOUGHT','OVERSOLD WATCH','DEAD CAT?','IN NO MAN\'S LAND','BREAKING DOWN','AVOID','NEUTRAL'];

const WarRoom = ({ coins, techMap }) => {
  const ready = Object.keys(techMap).length > 30;

  const classified = useMemo(() => {
    if (!ready) return {};
    const map = {};
    coins.forEach(coin => {
      const tech = techMap[coin.symbol];
      const result = classify(coin, tech);
      if (!result) return;
      if (!map[result.verdict]) map[result.verdict] = { ...result, coins:[] };
      map[result.verdict].coins.push(coin);
    });
    // Sort coins within each verdict by momentum desc
    Object.values(map).forEach(v => {
      v.coins.sort((a,b)=>(techMap[b.symbol]?.momentum||0)-(techMap[a.symbol]?.momentum||0));
    });
    return map;
  }, [coins, techMap, ready]);

  // Hot Intel — top 3 most interesting setups
  const hotIntel = useMemo(() => {
    if (!ready) return [];
    const picks = [];
    // Priority: golden cross + above all EMAs
    coins.filter(c=>techMap[c.symbol]?.cross==='GOLDEN'&&getZone(c.price,techMap[c.symbol].e55,techMap[c.symbol].e90,techMap[c.symbol].e200)==='FULL_BULL')
      .slice(0,1).forEach(c=>picks.push({ coin:c, tag:'GOLDEN CROSS + FULL BULL', color:'#CCFF00', read:`${c.display} just crossed golden AND is above all EMAs. Rare combo. Watch for follow-through.` }));
    // Oversold bounce candidates
    coins.filter(c=>{ const t=techMap[c.symbol]; return t&&t.rsi<28&&c.ch>2; })
      .slice(0,1).forEach(c=>picks.push({ coin:c, tag:'OVERSOLD BOUNCE FORMING', color:'#F5A200', read:`${c.display} RSI at ${techMap[c.symbol].rsi?.toFixed(0)} and showing green today. Potential snap-back in play.` }));
    // Death cross warning
    coins.filter(c=>techMap[c.symbol]?.cross==='DEATH').slice(0,1)
      .forEach(c=>picks.push({ coin:c, tag:'DEATH CROSS JUST FIRED', color:'#FF2D55', read:`${c.display} EMA 55 just crossed below EMA 90. Trend officially flipping bearish. Get light or get out.` }));
    // Top momentum not overbought
    const topMom = [...coins].filter(c=>{ const t=techMap[c.symbol]; return t&&t.momentum>=80&&t.rsi&&t.rsi<68; }).sort((a,b)=>(techMap[b.symbol]?.momentum||0)-(techMap[a.symbol]?.momentum||0))[0];
    if (topMom && picks.length < 3) picks.push({ coin:topMom, tag:'PEAK MOMENTUM — NOT OVERBOUGHT', color:'#CCFF00', read:`${topMom.display} scores ${techMap[topMom.symbol].momentum}/100 and RSI hasn't redlined yet. Clean entry window.` });
    return picks.slice(0, 3);
  }, [coins, techMap, ready]);

  if (!ready) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(48px,10vw,100px)', color:'rgba(255,255,255,0.04)', letterSpacing:'-0.02em' }}>WAR ROOM</div>
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <div style={{ width:'8px', height:'8px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:MONO, fontSize:'10px', color:OR, letterSpacing:'0.2em' }}>AWAITING_DATA — Go to Scanner first.</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>

      {/* Masthead */}
      <div style={{ padding:'28px 24px 20px', borderBottom:`3px solid ${OR}`, background:'#0a0a0a' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:'8px', color:OR, letterSpacing:'0.4em', marginBottom:'6px', opacity:0.7 }}>// SIGNAL_CLASSIFICATION_ENGINE · LIVE</div>
            <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(56px,11vw,110px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em' }}>
              WAR<br/><span style={{ color:OR }}>ROOM</span>
            </h1>
          </div>
          <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', textAlign:'right', lineHeight:2.2, letterSpacing:'0.12em' }}>
            <div style={{ color:OR }}>CLASSIFICATION_ACTIVE_</div>
            <div>{Object.values(classified).reduce((s,v)=>s+v.coins.length,0)} COINS CLASSIFIED</div>
            <div>{Object.keys(classified).length} ACTIVE VERDICTS</div>
          </div>
        </div>
      </div>

      {/* HOT INTEL STRIP */}
      {hotIntel.length > 0 && (
        <div style={{ borderBottom:'1px solid rgba(255,255,255,0.06)', background:'#0d0d0d' }}>
          <div style={{ padding:'10px 24px 0', fontFamily:MONO, fontSize:'8px', color:OR, letterSpacing:'0.3em' }}>[ HOT_INTEL_ ] — TOP SETUPS RIGHT NOW</div>
          <div style={{ display:'flex', gap:'0', flexWrap:'wrap' }}>
            {hotIntel.map((item, i) => (
              <div key={i} style={{ flex:'1', minWidth:'240px', padding:'14px 24px 16px', borderRight:'1px solid rgba(255,255,255,0.06)', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                  <div style={{ width:'4px', height:'4px', background:item.color, borderRadius:'50%', animation:'blink 1.5s ease infinite' }} />
                  <span style={{ fontFamily:MONO, fontSize:'8px', color:item.color, letterSpacing:'0.2em', fontWeight:700 }}>{item.tag}</span>
                </div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'28px', color:'#fff', lineHeight:1, marginBottom:'4px' }}>{item.coin.display}</div>
                <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', lineHeight:1.7, letterSpacing:'0.03em' }}>{item.read}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SITUATION BOARD — verdicts as columns */}
      <div style={{ padding:'24px' }}>
        <div style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.3em', marginBottom:'20px' }}>
          [ SITUATION_BOARD_ ] — EVERY COIN CLASSIFIED BY CURRENT SIGNAL
        </div>

        {VERDICT_ORDER.filter(v=>classified[v]).map(verdict => {
          const group = classified[verdict];
          const isBull = ['LOCKED IN','ABOUT TO MOVE','OVERSOLD WATCH'].includes(verdict);
          const isBear = ['BREAKING DOWN','AVOID','DEAD CAT?'].includes(verdict);

          return (
            <div key={verdict} style={{ marginBottom:'3px', background:'#0d0d0d', border:`1px solid ${group.color}22` }}>
              {/* Verdict header */}
              <div style={{ display:'flex', alignItems:'stretch', gap:'0' }}>
                <div style={{ width:'5px', background:group.color, flexShrink:0 }} />
                <div style={{ flex:1, padding:'10px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${group.color}18` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:group.color, letterSpacing:'0.06em', textTransform:'uppercase' }}>{verdict}</span>
                    <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.1em' }}>{group.coins.length} COIN{group.coins.length!==1?'S':''}</span>
                  </div>
                  <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', maxWidth:'400px', textAlign:'right', lineHeight:1.5 }}>{group.short}</span>
                </div>
              </div>

              {/* Coin grid — big names, no fluff */}
              <div style={{ padding:'10px 16px 12px', display:'flex', flexWrap:'wrap', gap:'4px 2px' }}>
                {group.coins.map(coin => {
                  const t = techMap[coin.symbol];
                  const up = coin.ch >= 0;
                  const momCol = t?.momentum>=70?'#CCFF00':t?.momentum>=45?'#F5A200':t?.momentum>=25?'#FFE500':'#FF2D55';
                  return (
                    <div key={coin.symbol} style={{
                      padding:'6px 10px',
                      border:`1px solid ${group.color}20`,
                      background:`${group.color}06`,
                      display:'flex', flexDirection:'column', gap:'2px',
                      minWidth:'90px',
                    }}>
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:'#fff', letterSpacing:'0.02em', lineHeight:1 }}>{coin.display}</span>
                      <div style={{ display:'flex', gap:'6px', alignItems:'center' }}>
                        <span style={{ fontFamily:MONO, fontSize:'8px', color:up?'#CCFF00':'#FF2D55', fontWeight:700 }}>{up?'+':''}{coin.ch.toFixed(1)}%</span>
                        {t?.momentum !== undefined && (
                          <span style={{ fontFamily:MONO, fontSize:'7px', color:momCol }}>{t.momentum}</span>
                        )}
                        {t?.rsi !== null && t?.rsi !== undefined && (
                          <span style={{ fontFamily:MONO, fontSize:'7px', color:'#fff' }}>RSI{t.rsi.toFixed(0)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding:'16px 24px', borderTop:`2px solid ${OR}`, fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.14em', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
        <span>CLASSIFICATIONS_AUTO_GENERATED · NOT_FINANCIAL_ADVICE_</span>
        <span style={{ color:`${OR}60` }}>SIGNAL_ENGINE_v1.0 · POWERED_BY_BINANCE_DATA</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// THE EDGE
// ═══════════════════════════════════════════════════════════════════════════════

// ── WEAPON 1: WHALE TRAP SCORE ────────────────────────────────────────────────
// Price divergence from momentum. When price pumps but momentum lags = distribution.
// When price dumps but momentum holds = accumulation. That's the signal.
const whaleScore = (coin, tech) => {
  if (!tech || tech.rsi === null || tech.momentum === null) return null;
  const { rsi, momentum, e55, e90, atr } = tech;
  const price = coin.price;
  const ch = coin.ch;

  const atrMultiple = atr && atr > 0 ? Math.abs(ch / 100 * price) / atr : 1;
  const abnormalMove = atrMultiple > 1.8;
  const distFromE55 = e55 ? pct(price, e55) : 0;
  const overextended = Math.abs(distFromE55) > 12;

  // DISTRIBUTION — price pumping BUT RSI is weak (not confirming) AND momentum lagging
  // RSI must be below 58 to be "not confirming" — if RSI is high, the pump IS confirmed
  const pricePumping = ch > 5;
  const rsiNotConfirmingPump = rsi < 55;   // RSI should be higher if real buyers are in
  const momNotConfirmingPump = momentum < 50;

  if (pricePumping && rsiNotConfirmingPump && momNotConfirmingPump) {
    const strength = Math.min(100, Math.round(
      30 + (ch * 3) + (abnormalMove ? 20 : 0) + (overextended ? 15 : 0) + ((55 - rsi) * 0.5)
    ));
    return {
      type: 'DISTRIBUTION',
      color: '#FF2D55',
      strength,
      signal: 'POSSIBLE SELL-OFF INTO STRENGTH',
      read: `${coin.display} up ${ch.toFixed(1)}% today but RSI only at ${rsi.toFixed(0)} and momentum score just ${momentum}. Real buying pressure should push RSI higher. When price pumps but RSI lags, smart money is often selling into retail excitement.`,
      action: `Don't chase. If you're holding, tighten your stop. Wait for RSI to push above 60 before trusting this move.`,
    };
  }

  // ACCUMULATION — price dumping BUT RSI is genuinely holding up (not falling with price)
  // Strict thresholds: RSI must be between 40-62 (not oversold panic, not dangerously high)
  // AND momentum must be meaningfully holding (>45, not just scraping by)
  // AND the dump must be significant (-7% or worse)
  const priceDumping = ch < -7;
  const rsiHoldingUp = rsi >= 40 && rsi <= 62;   // holding — not crashing with price
  const momGenuinelyHolding = momentum > 45;      // real structural strength remaining

  if (priceDumping && rsiHoldingUp && momGenuinelyHolding) {
    const strength = Math.min(100, Math.round(
      30 + (Math.abs(ch) * 2.5) + (abnormalMove ? 20 : 0) + (overextended ? 10 : 0) + ((momentum - 45) * 0.8)
    ));
    return {
      type: 'ACCUMULATION',
      color: '#CCFF00',
      strength,
      signal: 'POSSIBLE ACCUMULATION',
      read: `${coin.display} down ${Math.abs(ch).toFixed(1)}% today but RSI holding at ${rsi.toFixed(0)} and momentum score at ${momentum} — neither is crashing with the price. When price drops hard but momentum and RSI hold, it can mean big players are absorbing the selling.`,
      action: `Don't buy the open dump. Wait for price to stabilize — look for a candle that closes near its high after the drop. That's the confirmation.`,
    };
  }

  // ABNORMAL MOVE — ATR spike, huge candle relative to normal range
  if (abnormalMove && Math.abs(ch) > 4 && overextended) {
    return {
      type: 'ABNORMAL MOVE',
      color: '#F5A200',
      strength: Math.min(100, Math.round(atrMultiple * 30)),
      signal: 'UNUSUAL SIZE MOVE',
      read: `${coin.display} moved ${Math.abs(ch).toFixed(1)}% today — that's ${atrMultiple.toFixed(1)}x its normal daily range. Something triggered this: news, a big order, or a stop hunt. Price is ${Math.abs(distFromE55).toFixed(1)}% ${distFromE55 > 0 ? 'above' : 'below'} EMA 55.`,
      action: `Don't trade the spike itself. Wait for the retest — price usually comes back to where the big move started. That's where the real setup forms.`,
    };
  }

  return null;
};

// ── WEAPON 2: BREAKOUT PRESSURE SCORE ─────────────────────────────────────────
// Combines volatility compression, EMA distance, RSI positioning and volume rank
// to generate a 0-100 pressure score. Higher = closer to an explosive move.
const breakoutScore = (coin, tech, volRank) => {
  if (!tech || !tech.e55 || !tech.atr) return null;
  const { e55, e90, e200, rsi, momentum, atr } = tech;
  const price = coin.price;

  let score = 0;
  const reasons = [];

  // ATR compression — low ATR relative to price = coiling (higher pressure)
  const atrPct = (atr / price) * 100;
  const compressionScore = Math.max(0, 30 - atrPct * 10); // tighter range = higher score
  score += Math.min(30, compressionScore);
  if (atrPct < 2.5) reasons.push(`range is tight (ATR ${atrPct.toFixed(1)}% of price)`);

  // RSI in sweet spot — 45-60 = coiled, not extended
  if (rsi !== null) {
    if (rsi >= 45 && rsi <= 62) { score += 25; reasons.push(`RSI ${rsi.toFixed(0)} in breakout zone`); }
    else if (rsi > 62 && rsi <= 72) score += 12;
    else if (rsi < 45 && rsi > 35) score += 10;
  }

  // Close to EMA 55 — within 5% above = launch pad
  const distE55 = pct(price, e55);
  if (distE55 !== null && distE55 >= 0 && distE55 < 5) { score += 20; reasons.push(`sitting on EMA 55`); }
  else if (distE55 !== null && distE55 >= 5 && distE55 < 10) score += 10;

  // EMA stack building — 55 and 90 aligned even if 200 not yet
  if (e55 && e90 && e55 > e90) { score += 15; reasons.push(`EMA 55 above EMA 90`); }

  // Volume rank bonus — high volume coin with pressure = more explosive
  if (volRank <= 10) score += 10;
  else if (volRank <= 25) score += 5;

  if (score < 40) return null; // not interesting enough

  const level = score >= 80 ? 'CRITICAL' : score >= 65 ? 'HIGH' : 'BUILDING';
  const levelColor = score >= 80 ? '#FF2D55' : score >= 65 ? '#F5A200' : '#FFE500';

  return { score: Math.min(100, Math.round(score)), level, levelColor, reasons };
};

// ── WEAPON 3: THE PLAYBOOK ────────────────────────────────────────────────────
// Generates a real trade setup from the data. Not a prediction — a framework.
const generatePlay = (coin, tech) => {
  if (!tech || !tech.e55 || !tech.e90 || tech.rsi === null) return null;
  const { e55, e90, e200, rsi, momentum, cross, atr } = tech;
  const price = coin.price;
  const zone  = getZone(price, e55, e90, e200);

  // Only generate plays for coins with clear setups
  const validZones = ['FULL_BULL','ABOVE_ALL','COILING','RECOVERY'];
  if (!validZones.includes(zone) && cross !== 'GOLDEN' && rsi > 35) return null;
  if (momentum < 35 && cross !== 'GOLDEN' && rsi > 32) return null;

  // Determine play type
  let playType, entry, confirm, invalidate, target, thesis, risk;

  if (zone === 'FULL_BULL' && momentum >= 65) {
    playType = 'TREND CONTINUATION';
    entry    = `Dip to EMA 55 ($${fmt(e55)}) — ${pct(price,e55)?.toFixed(1)}% below current price`;
    confirm  = `Price holds EMA 55 on close. RSI holds above 50. Volume increases on bounce.`;
    invalidate = `Daily close below EMA 55 with momentum score dropping under 50.`;
    target   = e200 ? `$${fmt(price * 1.12)} (+12%) — previous resistance zone` : `$${fmt(price * 1.1)} (+10%)`;
    thesis   = `${coin.display} is in a clean uptrend — EMAs stacked, momentum healthy at ${momentum}. The play is to buy the dip, not chase the pump. EMA 55 is your floor.`;
    risk     = 'LOW-MEDIUM';
  } else if (cross === 'GOLDEN') {
    playType = 'GOLDEN CROSS BREAKOUT';
    entry    = `Current price $${fmt(price)} or pullback to $${fmt(e55)} (${pct(price,e55)?.toFixed(1)}% away)`;
    confirm  = `Price stays above both EMA 55 and EMA 90 on any dips. Volume expanding.`;
    invalidate = `Price crosses back below EMA 90 ($${fmt(e90)}). That would signal the cross failed.`;
    target   = `$${fmt(price * 1.15)} (+15%) first target. If holds, ${e200?`EMA 200 at $${fmt(e200)}`:'next major resistance'}`;
    thesis   = `EMA 55 just crossed above EMA 90 on ${coin.display}. Short-term trend is officially flipping bullish. Fresh crossovers have the best follow-through — this is early, not late.`;
    risk     = 'MEDIUM';
  } else if (zone === 'COILING' && rsi >= 45 && rsi <= 60) {
    playType = 'COIL BREAKOUT SETUP';
    entry    = `Wait for reclaim of EMA 55 ($${fmt(e55)}) on a daily close. Don't buy early.`;
    confirm  = `Daily close above EMA 55 with RSI pushing above 55. Volume spike on breakout candle.`;
    invalidate = `Loss of EMA 200 ($${e200?fmt(e200):'N/A'}). That ends this setup.`;
    target   = `$${fmt(e55 * 1.1)} — first target after reclaim, then re-evaluate`;
    thesis   = `${coin.display} is sitting above EMA 200 but lost EMA 55 and 90. It's coiling. RSI at ${rsi.toFixed(0)} is neutral — not oversold enough to bounce, not overextended. The trade is the breakout, not the anticipation.`;
    risk     = 'MEDIUM-HIGH';
  } else if (rsi < 32 && momentum > 25) {
    playType = 'OVERSOLD SNAP-BACK';
    entry    = `Scale in near current price ($${fmt(price)}). RSI at ${rsi.toFixed(0)} — extreme territory.`;
    confirm  = `RSI turns up from under 30. Green daily candle. Price holds above recent lows.`;
    invalidate = `New daily low. If price keeps making lows while RSI makes lower lows, no bounce is coming.`;
    target   = `$${fmt(e55)} — EMA 55 at ${pct(price,e55)?.toFixed(1)}% above. That's the first recovery target.`;
    thesis   = `${coin.display} has been sold extremely hard. RSI at ${rsi.toFixed(0)} doesn't stay here for long. The snap-back play targets EMA 55 recovery. High risk — this can always go lower — but the reward is asymmetric.`;
    risk     = 'HIGH';
  } else if (zone === 'RECOVERY' && momentum >= 50) {
    playType = 'RECOVERY BREAKOUT';
    entry    = `Current price or pullback to EMA 90 ($${fmt(e90)})`;
    confirm  = `Daily close above EMA 200 ($${e200?fmt(e200):'not yet available'}). That's the wall.`;
    invalidate = `Loss of EMA 90 ($${fmt(e90)}). Back to no-man's-land.`;
    target   = e200 ? `Break above EMA 200 at $${fmt(e200)} — then open air above` : `Extended target +15-20% from entry`;
    thesis   = `${coin.display} reclaimed EMA 55 and 90 but EMA 200 is still overhead. Momentum at ${momentum} is building. The play is the EMA 200 break — that's when this flips from recovery to full bull.`;
    risk     = 'MEDIUM';
  } else {
    return null;
  }

  return { playType, entry, confirm, invalidate, target, thesis, risk };
};

// ── THE EDGE PAGE ─────────────────────────────────────────────────────────────
const TheEdge = ({ coins, techMap }) => {
  const ready = Object.keys(techMap).length > 30;

  const volRanks = useMemo(() => {
    const sorted = [...coins].sort((a,b)=>b.vol-a.vol);
    const map = {};
    sorted.forEach((c,i) => { map[c.symbol] = i+1; });
    return map;
  }, [coins]);

  const { distributions, accumulations, abnormal } = useMemo(() => {
    if (!ready) return { distributions:[], accumulations:[], abnormal:[] };
    const d=[], a=[], ab=[];
    coins.forEach(coin => {
      const tech = techMap[coin.symbol];
      const ws = whaleScore(coin, tech);
      if (!ws) return;
      if (ws.type==='DISTRIBUTION') d.push({ coin, tech, ws });
      else if (ws.type==='ACCUMULATION') a.push({ coin, tech, ws });
      else ab.push({ coin, tech, ws });
    });
    d.sort((x,y)=>y.ws.strength-x.ws.strength);
    a.sort((x,y)=>y.ws.strength-x.ws.strength);
    ab.sort((x,y)=>y.ws.strength-x.ws.strength);
    return { distributions:d.slice(0,8), accumulations:a.slice(0,8), abnormal:ab.slice(0,6) };
  }, [coins, techMap, ready]);

  const pressureCoins = useMemo(() => {
    if (!ready) return [];
    return coins
      .map(coin => ({ coin, tech:techMap[coin.symbol], bs:breakoutScore(coin, techMap[coin.symbol], volRanks[coin.symbol]||999) }))
      .filter(x=>x.bs)
      .sort((a,b)=>b.bs.score-a.bs.score)
      .slice(0,12);
  }, [coins, techMap, volRanks, ready]);

  const plays = useMemo(() => {
    if (!ready) return [];
    return coins
      .map(coin => ({ coin, tech:techMap[coin.symbol], play:generatePlay(coin, techMap[coin.symbol]) }))
      .filter(x=>x.play)
      .sort((a,b)=>(techMap[b.coin.symbol]?.momentum||0)-(techMap[a.coin.symbol]?.momentum||0))
      .slice(0,6);
  }, [coins, techMap, ready]);

  if (!ready) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(48px,10vw,100px)', color:'rgba(255,255,255,0.04)', letterSpacing:'-0.02em' }}>THE EDGE</div>
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <div style={{ width:'8px', height:'8px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:MONO, fontSize:'14px', color:OR, letterSpacing:'0.2em' }}>LOADING_DATA — Go to Scanner first.</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>

      {/* Masthead */}
      <div style={{ padding:'28px 24px 20px', borderBottom:`3px solid ${OR}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:OR, letterSpacing:'0.4em', marginBottom:'6px', opacity:0.7 }}>// THREE_WEAPONS · WHAT_RETAIL_DOESN'T_SEE</div>
            <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(56px,11vw,110px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em' }}>
              THE<br/><span style={{ color:OR }}>EDGE</span>
            </h1>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', alignItems:'flex-end' }}>
            {[
              { label:'WHALE TRAPS DETECTED', val: distributions.length + accumulations.length + abnormal.length, c:OR },
              { label:'COINS UNDER PRESSURE', val: pressureCoins.length, c:'#FFE500' },
              { label:'ACTIVE PLAYBOOK SETUPS', val: plays.length, c:'#CCFF00' },
            ].map(({label,val,c})=>(
              <div key={label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'6px 12px', border:`1px solid ${c}25`, background:`${c}06` }}>
                <span style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', letterSpacing:'0.12em' }}>{label}</span>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'24px', color:c, lineHeight:1 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── WEAPON 01: WHALE TRAP DETECTOR ── */}
      <section style={{ padding:'32px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'stretch', gap:'0', marginBottom:'20px' }}>
          <div style={{ width:'5px', background:OR, flexShrink:0 }} />
          <div style={{ flex:1, borderTop:`2px solid ${OR}`, padding:'10px 16px' }}>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:OR, letterSpacing:'0.3em', marginBottom:'3px' }}>WEAPON_01</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', letterSpacing:'0.02em', lineHeight:1 }}>WHALE TRAP DETECTOR</div>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'6px', lineHeight:1.7, borderLeft:`2px solid ${OR}40`, paddingLeft:'10px' }}>
              Detects when price and momentum are moving in opposite directions. That divergence is the fingerprint of big players — either distributing (dumping into your buy) or accumulating (quietly loading while price bleeds). Retail doesn't see this. Now you do.
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'2px' }}>
          {/* Accumulation column */}
          <div>
            <div style={{ padding:'10px 14px', borderTop:'3px solid #CCFF00', background:'rgba(204,255,0,0.05)', marginBottom:'2px' }}>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:'#CCFF00', letterSpacing:'0.2em', fontWeight:700 }}>[ ACCUMULATION_ ] — SMART MONEY LOADING</div>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'3px', lineHeight:1.5 }}>Price dumping but momentum holding. Someone is absorbing the sell pressure.</div>
            </div>
            {accumulations.length===0 && <div style={{ padding:'16px 14px', fontFamily:MONO, fontSize:'13px', color:'#fff' }}>None detected right now.</div>}
            {accumulations.map(({coin,ws}) => (
              <div key={coin.symbol} style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:'#0d0d0d' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                  <div>
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff' }}>{coin.display}</span>
                    <div style={{ fontFamily:MONO, fontSize:'13px', color:'#FF2D55', marginTop:'1px' }}>{coin.ch.toFixed(1)}% today</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:MONO, fontSize:'13px', color:'#CCFF00', letterSpacing:'0.1em', marginBottom:'3px' }}>{ws.signal}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:'4px', justifyContent:'flex-end' }}>
                      <div style={{ width:'40px', height:'3px', background:'rgba(255,255,255,0.06)' }}>
                        <div style={{ height:'100%', width:`${ws.strength}%`, background:'#CCFF00' }} />
                      </div>
                      <span style={{ fontFamily:MONO, fontSize:'13px', color:'#CCFF00', fontWeight:700 }}>{ws.strength}</span>
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', lineHeight:1.65, marginBottom:'5px' }}>{ws.read}</div>
                <div style={{ fontFamily:MONO, fontSize:'13px', color:'rgba(204,255,0,0.5)', lineHeight:1.6, borderLeft:'2px solid rgba(204,255,0,0.3)', paddingLeft:'8px' }}>{ws.action}</div>
              </div>
            ))}
          </div>

          {/* Distribution column */}
          <div>
            <div style={{ padding:'10px 14px', borderTop:'3px solid #FF2D55', background:'rgba(255,45,85,0.05)', marginBottom:'2px' }}>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:'#FF2D55', letterSpacing:'0.2em', fontWeight:700 }}>[ DISTRIBUTION_ ] — SMART MONEY UNLOADING</div>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'3px', lineHeight:1.5 }}>Price pumping but momentum lagging. Big players selling into retail hype.</div>
            </div>
            {distributions.length===0 && <div style={{ padding:'16px 14px', fontFamily:MONO, fontSize:'13px', color:'#fff' }}>None detected right now.</div>}
            {distributions.map(({coin,ws}) => (
              <div key={coin.symbol} style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,0.04)', background:'#0d0d0d' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                  <div>
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff' }}>{coin.display}</span>
                    <div style={{ fontFamily:MONO, fontSize:'13px', color:'#CCFF00', marginTop:'1px' }}>+{coin.ch.toFixed(1)}% today</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:MONO, fontSize:'13px', color:'#FF2D55', letterSpacing:'0.1em', marginBottom:'3px' }}>{ws.signal}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:'4px', justifyContent:'flex-end' }}>
                      <div style={{ width:'40px', height:'3px', background:'rgba(255,255,255,0.06)' }}>
                        <div style={{ height:'100%', width:`${ws.strength}%`, background:'#FF2D55' }} />
                      </div>
                      <span style={{ fontFamily:MONO, fontSize:'13px', color:'#FF2D55', fontWeight:700 }}>{ws.strength}</span>
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', lineHeight:1.65, marginBottom:'5px' }}>{ws.read}</div>
                <div style={{ fontFamily:MONO, fontSize:'13px', color:'rgba(255,45,85,0.5)', lineHeight:1.6, borderLeft:'2px solid rgba(255,45,85,0.3)', paddingLeft:'8px' }}>{ws.action}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Abnormal moves */}
        {abnormal.length > 0 && (
          <div style={{ marginTop:'2px' }}>
            <div style={{ padding:'8px 14px', borderTop:`2px solid ${OR}`, background:`${OR}08`, marginBottom:'2px' }}>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:OR, letterSpacing:'0.2em', fontWeight:700 }}>[ ABNORMAL_MOVES_ ] — SOMETHING TRIGGERED THIS</div>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'2px' }}>
              {abnormal.map(({coin,ws}) => (
                <div key={coin.symbol} style={{ flex:'1', minWidth:'200px', padding:'10px 14px', background:'#0d0d0d', border:`1px solid ${OR}20` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff' }}>{coin.display}</span>
                    <span style={{ fontFamily:MONO, fontSize:'13px', color:coin.ch>=0?GR:RD, fontWeight:700 }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(1)}%</span>
                  </div>
                  <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', lineHeight:1.6 }}>{ws.read}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── WEAPON 02: BREAKOUT PRESSURE GAUGE ── */}
      <section style={{ padding:'32px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display:'flex', alignItems:'stretch', gap:'0', marginBottom:'20px' }}>
          <div style={{ width:'5px', background:'#FFE500', flexShrink:0 }} />
          <div style={{ flex:1, borderTop:'2px solid #FFE500', padding:'10px 16px' }}>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:'#FFE500', letterSpacing:'0.3em', marginBottom:'3px' }}>WEAPON_02</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', letterSpacing:'0.02em', lineHeight:1 }}>BREAKOUT PRESSURE GAUGE</div>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'6px', lineHeight:1.7, borderLeft:'2px solid rgba(255,229,0,0.3)', paddingLeft:'10px' }}>
              Measures how much pressure is building in a coin. Uses volatility compression, RSI position, EMA distance and volume rank. Higher score = the spring is wound tighter. These are the coins closest to an explosive move — in either direction.
            </div>
          </div>
        </div>

        {pressureCoins.map(({coin, bs}, i) => (
          <div key={coin.symbol} style={{ display:'flex', alignItems:'center', gap:'0', marginBottom:'2px', background:'#0d0d0d', border:`1px solid ${bs.levelColor}18` }}>
            <div style={{ width:'4px', alignSelf:'stretch', background:bs.levelColor, flexShrink:0 }} />
            <div style={{ flex:1, padding:'10px 14px', display:'flex', alignItems:'center', gap:'14px', flexWrap:'wrap' }}>
              <span style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', width:'20px', flexShrink:0 }}>#{i+1}</span>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff', width:'80px', flexShrink:0 }}>{coin.display}</span>
              {/* Pressure bar */}
              <div style={{ flex:1, minWidth:'120px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ fontFamily:MONO, fontSize:'13px', color:bs.levelColor, letterSpacing:'0.14em', fontWeight:700 }}>{bs.level}</span>
                  <span style={{ fontFamily:MONO, fontSize:'13px', color:bs.levelColor, fontWeight:700 }}>{bs.score}/100</span>
                </div>
                <div style={{ height:'6px', background:'rgba(255,255,255,0.05)' }}>
                  <div style={{ height:'100%', width:`${bs.score}%`, background:bs.levelColor, transition:'width 0.6s ease' }} />
                </div>
              </div>
              {/* Reasons */}
              <div style={{ display:'flex', gap:'4px', flexWrap:'wrap', flex:1, minWidth:'150px' }}>
                {bs.reasons.map((r,j) => (
                  <span key={j} style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', padding:'2px 6px', border:'1px solid rgba(255,255,255,0.08)', letterSpacing:'0.06em' }}>{r}</span>
                ))}
              </div>
              <span style={{ fontFamily:MONO, fontSize:'13px', color:coin.ch>=0?GR:RD, width:'48px', textAlign:'right', flexShrink:0, fontWeight:700 }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </section>

      {/* ── WEAPON 03: THE PLAYBOOK ── */}
      <section style={{ padding:'32px 24px', paddingBottom:'60px' }}>
        <div style={{ display:'flex', alignItems:'stretch', gap:'0', marginBottom:'20px' }}>
          <div style={{ width:'5px', background:GR, flexShrink:0 }} />
          <div style={{ flex:1, borderTop:`2px solid ${GR}`, padding:'10px 16px' }}>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:GR, letterSpacing:'0.3em', marginBottom:'3px' }}>WEAPON_03</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', letterSpacing:'0.02em', lineHeight:1 }}>THE PLAYBOOK</div>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'6px', lineHeight:1.7, borderLeft:`2px solid ${GR}40`, paddingLeft:'10px' }}>
              For every coin with a clean technical setup, the engine writes out the actual trade. Entry zone, what confirms it, what invalidates it, and the target. Not a prediction. A framework. Derived entirely from EMA structure, RSI, momentum, and price action — no opinions, just math translated into plain language.
            </div>
          </div>
        </div>

        {plays.length === 0 && (
          <div style={{ padding:'24px', border:'1px solid rgba(255,255,255,0.06)', background:'#0d0d0d' }}>
            <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', letterSpacing:'0.12em' }}>[ NO_CLEAN_SETUPS_ ] — Market doesn't always offer edge. Check back when conditions improve.</div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:'2px' }}>
          {plays.map(({coin, tech, play}) => {
            const riskColor = play.risk==='LOW-MEDIUM'?GR : play.risk==='MEDIUM'?OR : play.risk==='MEDIUM-HIGH'?'#FFE500' : RD;
            return (
              <div key={coin.symbol} style={{ background:'#0d0d0d', border:`1px solid ${GR}20`, display:'flex', flexDirection:'column' }}>
                {/* Play header */}
                <div style={{ borderTop:`3px solid ${GR}`, padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div>
                      <div style={{ fontFamily:MONO, fontSize:'13px', color:GR, letterSpacing:'0.2em', marginBottom:'4px' }}>{play.playType}</div>
                      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:'#fff', lineHeight:1, letterSpacing:'0.02em' }}>{coin.display}</div>
                      <div style={{ fontFamily:MONO, fontSize:'13px', color:coin.ch>=0?GR:RD, marginTop:'2px', fontWeight:700 }}>{coin.ch>=0?'+':''}{coin.ch.toFixed(2)}% today · ${fmt(coin.price)}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', letterSpacing:'0.12em', marginBottom:'3px' }}>RISK LEVEL</div>
                      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:riskColor, letterSpacing:'0.08em' }}>{play.risk}</div>
                      <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', marginTop:'4px' }}>Score: {tech.momentum}/100</div>
                    </div>
                  </div>
                </div>

                {/* Thesis */}
                <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', background:'rgba(0,0,0,0.3)' }}>
                  <div style={{ fontFamily:MONO, fontSize:'13px', color:GR, letterSpacing:'0.2em', marginBottom:'6px', opacity:0.7 }}>THE THESIS</div>
                  <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', lineHeight:1.7 }}>{play.thesis}</div>
                </div>

                {/* Play details */}
                <div style={{ flex:1, padding:'12px 16px' }}>
                  {[
                    { label:'ENTRY_ZONE', val:play.entry, c:OR },
                    { label:'CONFIRMATION', val:play.confirm, c:GR },
                    { label:'INVALIDATION', val:play.invalidate, c:RD },
                    { label:'TARGET', val:play.target, c:'#FFE500' },
                  ].map(({label,val,c})=>(
                    <div key={label} style={{ padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ fontFamily:MONO, fontSize:'11px', color:c, letterSpacing:'0.16em', marginBottom:'4px', fontWeight:700 }}>{label}</div>
                      <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', lineHeight:1.6 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <div style={{ padding:'16px 24px', borderTop:`2px solid ${OR}`, fontFamily:MONO, fontSize:'13px', color:'#fff', letterSpacing:'0.12em', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
        <span>EDGE_TOOLS_AUTO_GENERATED · NOT_FINANCIAL_ADVICE · DO_YOUR_OWN_RESEARCH</span>
        <span style={{ color:`${OR}60` }}>POWERED_BY_EMA_RSI_ATR_MOMENTUM_DATA</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// DERIVATIVES PAGE
// ═══════════════════════════════════════════════════════════════════════════════

// ── LIVE LIQUIDATION FEED ─────────────────────────────────────────────────────
// Binance streams ALL liquidation orders via WebSocket — !forceOrder@arr
const useLiqFeed = (active) => {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('CONNECTING');
  const wsRef = useRef(null);
  const countRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    let ws;
    let reconnectTimer;

    const connect = () => {
      setStatus('CONNECTING');
      ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
      wsRef.current = ws;

      ws.onopen = () => { setStatus('LIVE'); countRef.current = 0; };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const o = msg.o || msg;
          if (!o || !o.s) return;
          const usdVal = parseFloat(o.q) * parseFloat(o.ap || o.p);
          if (usdVal < 10000) return; // filter tiny liq < $10k
          const ev = {
            id:     ++countRef.current,
            time:   Date.now(),
            sym:    o.s.replace('USDT',''),
            side:   o.S === 'SELL' ? 'LONG' : 'SHORT', // SELL order = long liq, BUY = short liq
            usd:    usdVal,
            price:  parseFloat(o.ap || o.p),
            ts:     new Date().toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' }),
          };
          setEvents(prev => [ev, ...prev].slice(0, 120)); // keep last 120
        } catch {}
      };

      ws.onerror = () => setStatus('ERROR');
      ws.onclose = () => {
        setStatus('RECONNECTING');
        reconnectTimer = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [active]);

  return { events, status };
};

const LiqFeed = ({ active }) => {
  const { events, status } = useLiqFeed(active);
  const [filter, setFilter] = useState('ALL'); // ALL | LONG | SHORT
  const [minSize, setMinSize] = useState(50000); // $50k default

  const filtered = useMemo(() =>
    events.filter(e =>
      (filter === 'ALL' || e.side === filter) &&
      e.usd >= minSize
    ), [events, filter, minSize]);

  // Stats from events
  const stats = useMemo(() => {
    if (!events.length) return null;
    const longLiqs  = events.filter(e=>e.side==='LONG');
    const shortLiqs = events.filter(e=>e.side==='SHORT');
    const totalUsd  = events.reduce((s,e)=>s+e.usd,0);
    const longUsd   = longLiqs.reduce((s,e)=>s+e.usd,0);
    const shortUsd  = shortLiqs.reduce((s,e)=>s+e.usd,0);
    // Most hit coin
    const byCoin = {};
    events.forEach(e=>{ byCoin[e.sym]=(byCoin[e.sym]||0)+e.usd; });
    const topCoin = Object.entries(byCoin).sort((a,b)=>b[1]-a[1])[0];
    return { total:events.length, longN:longLiqs.length, shortN:shortLiqs.length, totalUsd, longUsd, shortUsd, topCoin };
  }, [events]);

  const fmtUsd = (v) => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;

  const statusColor = status==='LIVE'?GR : status==='RECONNECTING'?OR : status==='ERROR'?RD : OR;

  return (
    <div style={{ background:'#0a0a0a' }}>

      {/* Feed header */}
      <div style={{ padding:'28px 24px 20px', borderBottom:`3px solid ${RD}` }}>
        <div style={{ fontFamily:MONO, fontSize:'14px', color:RD, letterSpacing:'0.4em', marginBottom:'8px', opacity:0.8 }}>// LIVE_LIQUIDATION_SCANNER · WEBSOCKET</div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'16px' }}>
          <div>
            <h2 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(42px,8vw,80px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em' }}>
              WHO<br/><span style={{ color:RD }}>JUST GOT</span><br/>REKT
            </h2>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px', alignItems:'flex-end' }}>
            {/* Live status */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 16px', border:`1px solid ${statusColor}40`, background:`${statusColor}10` }}>
              <div style={{ width:'8px', height:'8px', background:statusColor, borderRadius:'50%', animation: status==='LIVE'?'blink 1.5s ease infinite':'none' }} />
              <span style={{ fontFamily:MONO, fontSize:'14px', color:statusColor, letterSpacing:'0.2em', fontWeight:700 }}>{status}</span>
            </div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', textAlign:'right', lineHeight:1.8 }}>
              {events.length} liquidations captured<br/>
              WebSocket: fstream.binance.com
            </div>
          </div>
        </div>

        {/* Plain english explainer */}
        <div style={{ marginTop:'16px', fontFamily:COND, fontWeight:900, fontSize:'16px', color:'#fff', maxWidth:'580px', lineHeight:1.7 }}>
          Every time someone using leverage gets forcibly wiped out, it shows here in real time. LONG liquidation = someone was betting up and got destroyed. SHORT liquidation = someone was betting down and got squeezed. Big liquidations move the price — now you see them before you feel them.
        </div>
      </div>

      {/* Live stats strip */}
      {stats && (
        <div style={{ display:'flex', gap:'0', borderBottom:'1px solid rgba(255,255,255,0.06)', flexWrap:'wrap' }}>
          {[
            { label:'TOTAL WIPED', val:fmtUsd(stats.totalUsd), sub:`${stats.total} liquidations`, color:'#fff' },
            { label:'LONGS REKT', val:fmtUsd(stats.longUsd), sub:`${stats.longN} positions`, color:RD },
            { label:'SHORTS REKT', val:fmtUsd(stats.shortUsd), sub:`${stats.shortN} positions`, color:GR },
            { label:'MOST HIT', val:stats.topCoin?.[0]||'—', sub:stats.topCoin?fmtUsd(stats.topCoin[1]):'', color:OR },
          ].map(({label,val,sub,color})=>(
            <div key={label} style={{ flex:'1', minWidth:'140px', padding:'16px 20px', borderRight:'1px solid rgba(255,255,255,0.05)', background:'#0d0d0d' }}>
              <div style={{ fontFamily:MONO, fontSize:'13px', color:'#fff', letterSpacing:'0.18em', marginBottom:'6px' }}>{label}</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color, lineHeight:1, letterSpacing:'-0.01em' }}>{val}</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', marginTop:'3px' }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ padding:'12px 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:'3px' }}>
          {['ALL','LONG','SHORT'].map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{
              all:'unset', cursor:'pointer', padding:'6px 14px',
              fontFamily:MONO, fontWeight:700, fontSize:'14px', letterSpacing:'0.12em',
              color: filter===f?'#0a0a0a':f==='LONG'?RD:f==='SHORT'?GR:'rgba(255,255,255,0.5)',
              background: filter===f?(f==='LONG'?RD:f==='SHORT'?GR:OR):'transparent',
              border:`1px solid ${filter===f?'transparent':f==='LONG'?RD+'40':f==='SHORT'?GR+'40':'rgba(255,255,255,0.12)'}`,
              transition:'all 0.1s',
            }}>{f==='LONG'?'LONGS REKT':f==='SHORT'?'SHORTS REKT':'ALL'}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:'3px', marginLeft:'auto' }}>
          {[10000,50000,100000,500000,1000000].map(v=>(
            <button key={v} onClick={()=>setMinSize(v)} style={{
              all:'unset', cursor:'pointer', padding:'6px 10px',
              fontFamily:MONO, fontWeight:700, fontSize:'13px', letterSpacing:'0.08em',
              color: minSize===v?'#0a0a0a':'rgba(255,255,255,0.4)',
              background: minSize===v?OR:'transparent',
              border:`1px solid ${minSize===v?OR:'rgba(255,255,255,0.1)'}`,
              transition:'all 0.1s',
            }}>{v>=1e6?`$${v/1e6}M+`:v>=1e3?`$${v/1e3}K+`:`$${v}+`}</button>
          ))}
        </div>
      </div>

      {/* Live feed */}
      <div style={{ minHeight:'400px' }}>
        {events.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 24px', gap:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ width:'10px', height:'10px', background:statusColor, borderRadius:'50%', animation:'blink 1s ease infinite' }} />
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff', letterSpacing:'0.1em' }}>
                {status === 'LIVE' ? 'WAITING FOR LIQUIDATIONS...' : `${status}...`}
              </span>
            </div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:'#fff', textAlign:'center', maxWidth:'360px', lineHeight:1.7 }}>
              Events will appear here in real time as leveraged positions get liquidated on Binance Futures.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding:'40px 24px', fontFamily:COND, fontWeight:900, fontSize:'18px', color:'#fff' }}>
            No liquidations match your filter. Try lowering the minimum size.
          </div>
        ) : (
          <div>
            {filtered.map((ev, i) => {
              const isLong   = ev.side === 'LONG';
              const col      = isLong ? RD : GR;
              const isBig    = ev.usd >= 500000;
              const isHuge   = ev.usd >= 1000000;
              const age      = Math.round((Date.now() - ev.time) / 1000);
              const ageStr   = age < 60 ? `${age}s ago` : `${Math.floor(age/60)}m ago`;

              return (
                <div key={ev.id} style={{
                  display:'flex', alignItems:'center', gap:'0',
                  borderBottom:'1px solid rgba(255,255,255,0.04)',
                  background: i===0 ? `${col}08` : '#0a0a0a',
                  animation: i===0 ? 'fadein 0.2s ease' : 'none',
                  borderLeft: isHuge ? `4px solid ${col}` : `4px solid transparent`,
                }}>
                  <div style={{ flex:1, padding:'12px 20px', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }}>

                    {/* Time */}
                    <span style={{ fontFamily:MONO, fontSize:'11px', color:'#fff', flexShrink:0, minWidth:'60px' }}>{ev.ts}</span>

                    {/* Coin */}
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'24px', color:'#fff', minWidth:'72px', flexShrink:0 }}>{ev.sym}</span>

                    {/* Side badge */}
                    <div style={{ padding:'4px 12px', background:col, flexShrink:0 }}>
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#000', letterSpacing:'0.1em' }}>
                        {isLong ? 'LONG REKT' : 'SHORT REKT'}
                      </span>
                    </div>

                    {/* Size — the main number */}
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize: isHuge?'32px':isBig?'26px':'22px', color:col, letterSpacing:'-0.01em', minWidth:'100px' }}>
                      {fmtUsd(ev.usd)}
                    </span>

                    {/* Price */}
                    <span style={{ fontFamily:MONO, fontSize:'12px', color:'#fff', flexShrink:0 }}>
                      @ ${fmt(ev.price)}
                    </span>

                    {/* Big liq tag */}
                    {isHuge && (
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:col, padding:'3px 10px', border:`1px solid ${col}50`, background:`${col}12`, animation:'blink 1s ease infinite' }}>
                        🔥 WHALE LIQUIDATION
                      </span>
                    )}
                    {isBig && !isHuge && (
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:OR, padding:'3px 10px', border:`1px solid ${OR}40` }}>BIG ONE</span>
                    )}

                    {/* Age */}
                    <span style={{ fontFamily:MONO, fontSize:'14px', color:'#fff', marginLeft:'auto', flexShrink:0 }}>{ageStr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const DERIV_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','SUIUSDT','APTUSDT','INJUSDT','TIAUSDT','NEARUSDT','PEPEUSDT','WIFUSDT','FETUSDT','ARBUSDT','OPUSDT'];

const useDerivData = () => {
  const [data,    setData]    = useState({});
  const [lsRatio, setLsRatio] = useState({});
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const fundRes  = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const fundJson = await fundRes.json();
        const fundMap  = {};
        fundJson.forEach(f => { if (f.symbol) fundMap[f.symbol] = parseFloat(f.lastFundingRate) * 100; });

        const oiResults = await Promise.allSettled(
          DERIV_SYMBOLS.map(sym =>
            fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`)
              .then(r => r.json())
              .then(d => ({ sym, oi: parseFloat(d.openInterest)||0 }))
              .catch(() => ({ sym, oi: null }))
          )
        );
        const oiMap = {};
        oiResults.forEach(r => { if (r.status==='fulfilled') oiMap[r.value.sym] = r.value.oi; });

        const perpTicker = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr').then(r=>r.json());
        const perpPrices = {};
        perpTicker.forEach(t => { perpPrices[t.symbol] = parseFloat(t.lastPrice); });

        const lsResults = await Promise.allSettled(
          DERIV_SYMBOLS.slice(0,10).map(sym =>
            fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=1`)
              .then(r=>r.json())
              .then(d => ({ sym, longPct: d[0] ? parseFloat(d[0].longAccount)*100 : null }))
              .catch(() => ({ sym, longPct:null }))
          )
        );
        const lsMap = {};
        lsResults.forEach(r => { if (r.status==='fulfilled' && r.value.longPct) lsMap[r.value.sym] = r.value.longPct; });

        const finalMap = {};
        DERIV_SYMBOLS.forEach(sym => {
          const oiContracts = oiMap[sym] ?? null;
          const perpPrice   = perpPrices[sym] ?? null;
          finalMap[sym] = {
            fundRate: fundMap[sym] ?? null,
            oiUsd:    oiContracts && perpPrice ? oiContracts * perpPrice : null,
            perpPrice,
          };
        });

        setData(finalMap);
        setLsRatio(lsMap);
      } catch(e) {
        setError('Could not load futures data. Binance futures API may be unavailable in your region.');
      } finally {
        setLoading(false);
      }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, []);

  return { data, lsRatio, loading, error };
};

// Big readable label — the verdict in one line
const Verdict = ({ text, color }) => (
  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color, letterSpacing:'0.06em', textTransform:'uppercase', marginTop:'4px' }}>{text}</div>
);

// What this means in plain human words
const WhatItMeans = ({ children }) => (
  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:'#fff', lineHeight:1.6, letterSpacing:'0.02em', marginBottom:'0' }}>{children}</div>
);

// Section header — large, clear
const DS = ({ num, title, subtitle, color=OR }) => (
  <div style={{ padding:'28px 24px 0' }}>
    <div style={{ fontFamily:MONO, fontSize:'14px', color:color, letterSpacing:'0.3em', marginBottom:'6px', opacity:0.8 }}>{num}</div>
    <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(28px,5vw,42px)', color:'#fff', letterSpacing:'0.02em', lineHeight:1, marginBottom:'8px' }}>{title}</div>
    <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:'#fff', lineHeight:1.6, maxWidth:'620px', paddingBottom:'20px', borderBottom:`1px solid rgba(255,255,255,0.06)` }}>{subtitle}</div>
  </div>
);

const DerivPage = ({ coins }) => {
  const { data, lsRatio, loading, error } = useDerivData();
  const [tab, setTab] = useState('FEED'); // 'FEED' | 'INTEL'

  const sorted = useMemo(() => {
    return DERIV_SYMBOLS
      .filter(sym => data[sym]?.fundRate != null)
      .map(sym => ({ sym: sym.replace('USDT',''), symbol:sym, ...data[sym] }))
      .sort((a,b) => Math.abs(b.fundRate) - Math.abs(a.fundRate));
  }, [data]);

  const sortedOI = useMemo(() => {
    return DERIV_SYMBOLS
      .filter(sym => data[sym]?.oiUsd)
      .map(sym => ({ sym: sym.replace('USDT',''), symbol:sym, ...data[sym] }))
      .sort((a,b) => (b.oiUsd||0) - (a.oiUsd||0));
  }, [data]);

  if (loading) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'24px', padding:'40px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(36px,8vw,72px)', color:'rgba(255,255,255,0.05)', letterSpacing:'-0.02em' }}>LOADING FUTURES DATA</div>
      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
        <div style={{ width:'10px', height:'10px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:OR, letterSpacing:'0.14em' }}>FETCHING LIVE DATA FROM BINANCE_</span>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px', padding:'40px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'28px', color:RD, letterSpacing:'0.1em' }}>[ API ERROR ]</div>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:'#fff', textAlign:'center', maxWidth:'480px', lineHeight:1.8 }}>{error}</div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>

      {/* Top tab switcher */}
      <div style={{ display:'flex', gap:'0', borderBottom:`3px solid ${OR}` }}>
        {[
          { key:'FEED',  label:'🔴 LIVE LIQUIDATIONS', sub:'Real-time WebSocket feed' },
          { key:'INTEL', label:'📊 FUTURES INTEL',      sub:'Funding · OI · L/S Ratio' },
        ].map(({key,label,sub})=>(
          <button key={key} onClick={()=>setTab(key)} style={{
            all:'unset', cursor:'pointer', flex:1,
            padding:'18px 24px',
            background: tab===key ? '#0d0d0d' : '#0a0a0a',
            borderRight:'1px solid rgba(255,255,255,0.06)',
            borderBottom: tab===key ? `3px solid ${key==='FEED'?RD:OR}` : '3px solid transparent',
            transition:'all 0.1s',
          }}>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color: tab===key?'#fff':'rgba(255,255,255,0.35)', letterSpacing:'0.04em', marginBottom:'3px' }}>{label}</div>
            <div style={{ fontFamily:MONO, fontSize:'10px', color: tab===key?OR:'rgba(255,255,255,0.2)', letterSpacing:'0.1em' }}>{sub}</div>
          </button>
        ))}
      </div>

      {/* LIVE LIQUIDATION FEED */}
      {tab === 'FEED' && <LiqFeed active={tab==='FEED'} />}

      {/* FUTURES INTEL */}
      {tab === 'INTEL' && <>

      {/* Masthead */}
      <div style={{ padding:'28px 24px 24px', borderBottom:`1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ fontFamily:MONO, fontSize:'10px', color:OR, letterSpacing:'0.4em', marginBottom:'8px', opacity:0.7 }}>// THE STUFF MOST TRADERS NEVER LOOK AT</div>
        <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(52px,10vw,100px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em', marginBottom:'16px' }}>
          FUTURES<br/><span style={{ color:OR }}>INTEL</span>
        </h1>
        <div style={{ fontFamily:COND, fontWeight:900, fontSize:'17px', color:'#fff', maxWidth:'560px', lineHeight:1.7 }}>
          This is derivatives data — the futures market where traders use leverage to bet big. Most spot traders ignore it. But this is where the real money moves, and it affects the price you see on every chart.
        </div>
      </div>

      {/* ── SECTION 1: FUNDING RATES ── */}
      <DS
        num="SECTION 01"
        title="FUNDING RATES"
        subtitle="Every 8 hours, futures traders pay each other a fee. This tells you if the market is dangerously one-sided — too many people betting up, or too many betting down. Both extremes end badly for whoever's in the majority."
        color={OR}
      />

      {/* How to read it — big visual guide */}
      <div style={{ padding:'20px 24px', display:'flex', gap:'4px', flexWrap:'wrap' }}>
        {[
          { label:'VERY POSITIVE', sub:'Too many longs', verdict:'DANGER — dump coming', color:RD, example:'>0.05%' },
          { label:'SLIGHTLY POSITIVE', sub:'Market leans long', verdict:'Healthy but watch it', color:OR, example:'0.01–0.05%' },
          { label:'NEAR ZERO', sub:'Balanced', verdict:'No edge either way', color:'#fff', example:'~0%' },
          { label:'NEGATIVE', sub:'Too many shorts', verdict:'Short squeeze coming', color:GR, example:'<0%' },
        ].map(({label,sub,verdict,color,example})=>(
          <div key={label} style={{ flex:'1', minWidth:'140px', padding:'16px', background:'#0d0d0d', borderTop:`3px solid ${color}` }}>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color, lineHeight:1, marginBottom:'4px' }}>{label}</div>
            <div style={{ fontFamily:MONO, fontSize:'10px', color:'#fff', marginBottom:'8px', letterSpacing:'0.06em' }}>{example}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', lineHeight:1.5, marginBottom:'6px' }}>{sub}</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color, lineHeight:1.5 }}>{verdict}</div>
          </div>
        ))}
      </div>

      {/* Live funding table */}
      <div style={{ padding:'0 24px 32px' }}>
        <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', letterSpacing:'0.1em', marginBottom:'12px', textTransform:'uppercase' }}>Live rates — sorted by most extreme first</div>
        {sorted.map((d, i) => {
          const rate    = d.fundRate;
          const isPos   = rate >= 0;
          const col     = rate > 0.05 ? RD : rate > 0.01 ? OR : rate >= 0 ? 'rgba(255,255,255,0.5)' : GR;
          const lsData  = lsRatio[d.symbol];
          const longPct = lsData ?? null;

          // Reconcile funding + L/S into one honest read
          let verdict, verdictColor;
          if (rate > 0.08) {
            verdict = '🔴 Extremely crowded longs. Forced liquidations likely soon.';
            verdictColor = RD;
          } else if (rate > 0.04) {
            verdict = '⚠️ Too many longs. If price dips, a big flush could follow.';
            verdictColor = OR;
          } else if (rate > 0.01) {
            if (longPct && longPct > 65) {
              verdict = '⚠️ Longs paying AND 69% of traders long — both signals say crowded. Be careful.';
              verdictColor = OR;
            } else {
              verdict = 'Longs paying shorts. Market leans bullish, not extreme yet.';
              verdictColor = OR;
            }
          } else if (rate >= 0) {
            if (longPct && longPct > 65) {
              verdict = `Funding looks calm but ${longPct.toFixed(0)}% of traders are long — position crowding even without high rates.`;
              verdictColor = OR;
            } else {
              verdict = 'Balanced. No strong signal from funding alone.';
              verdictColor = 'rgba(255,255,255,0.5)';
            }
          } else if (rate > -0.02) {
            if (longPct && longPct > 65) {
              verdict = `Mixed signal — funding is negative (shorts paying) but ${longPct.toFixed(0)}% of traders are still long. Positions haven't unwound yet.`;
              verdictColor = OR;
            } else {
              verdict = '🟢 Shorts are paying longs. Market leaning bearish on positioning — potential squeeze if price pumps.';
              verdictColor = GR;
            }
          } else {
            verdict = '🟢 Strongly negative funding. Lots of shorts — if price pumps, they all get forced to buy back.';
            verdictColor = GR;
          }

          return (
            <div key={d.symbol} style={{ display:'flex', alignItems:'center', gap:'0', marginBottom:'3px', background:'#0d0d0d', border:`1px solid ${col}18` }}>
              <div style={{ width:'5px', alignSelf:'stretch', background:col, flexShrink:0 }} />
              <div style={{ flex:1, padding:'12px 16px', display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }}>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff', width:'72px', flexShrink:0 }}>{d.sym}</span>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'28px', color:col, letterSpacing:'-0.01em', minWidth:'100px' }}>
                  {isPos?'+':''}{rate.toFixed(4)}%
                </span>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', flexShrink:0 }}>per 8h</span>
                <div style={{ flex:1, minWidth:'80px', height:'5px', background:'rgba(255,255,255,0.05)', position:'relative' }}>
                  <div style={{ position:'absolute', left:'50%', top:'-3px', width:'2px', height:'11px', background:'rgba(255,255,255,0.15)'}}/>
                  <div style={{
                    position:'absolute', height:'100%', background:col,
                    left: isPos ? '50%' : `${50 - Math.min(Math.abs(rate)*600,50)}%`,
                    width: `${Math.min(Math.abs(rate)*600,50)}%`,
                  }}/>
                </div>
                <span style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:verdictColor, flex:1, minWidth:'200px', textAlign:'right' }}>{verdict}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── SECTION 2: OPEN INTEREST ── */}
      <DS
        num="SECTION 02"
        title="OPEN INTEREST"
        subtitle="Total money sitting in active futures bets right now. High OI = lots of leverage in the market = bigger moves when price shifts. Think of it as fuel — more fuel means bigger explosions."
        color='#FFE500'
      />

      <div style={{ padding:'20px 24px 32px' }}>
        {/* Simple scale explainer */}
        <div style={{ display:'flex', gap:'4px', marginBottom:'20px', flexWrap:'wrap' }}>
          {[
            { label:'LOW OI', desc:'Not many bets placed. Move could fizzle out.', color:'#fff' },
            { label:'MEDIUM OI', desc:'Normal activity. Standard moves expected.', color:'#FFE500' },
            { label:'HIGH OI', desc:'Huge leverage sitting here. Big move incoming.', color:OR },
          ].map(({label,desc,color})=>(
            <div key={label} style={{ flex:'1', minWidth:'160px', padding:'14px 16px', background:'#0d0d0d', borderTop:`3px solid ${color}` }}>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color, marginBottom:'6px' }}>{label}</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', lineHeight:1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        {sortedOI.map((d,i) => {
          const maxOI = sortedOI[0]?.oiUsd || 1;
          const barW  = (d.oiUsd/maxOI)*100;
          const val   = d.oiUsd >= 1e9 ? `$${(d.oiUsd/1e9).toFixed(2)}B` : `$${(d.oiUsd/1e6).toFixed(0)}M`;
          const col   = i===0?OR:i<4?'#FFE500':'rgba(255,255,255,0.4)';
          const level = d.oiUsd >= 1e10 ? 'MASSIVE' : d.oiUsd >= 2e9 ? 'VERY HIGH' : d.oiUsd >= 5e8 ? 'HIGH' : 'NORMAL';
          return (
            <div key={d.symbol} style={{ display:'flex', alignItems:'center', gap:'16px', padding:'10px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff', width:'72px', flexShrink:0 }}>{d.sym}</span>
              <div style={{ flex:1, height:'6px', background:'rgba(255,255,255,0.05)' }}>
                <div style={{ height:'100%', width:`${barW}%`, background:col, transition:'width 0.6s' }}/>
              </div>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'24px', color:col, minWidth:'90px', textAlign:'right' }}>{val}</span>
              <span style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:col, minWidth:'80px', textAlign:'right', opacity:0.8 }}>{level}</span>
            </div>
          );
        })}
      </div>

      {/* ── SECTION 3: LONG / SHORT RATIO ── */}
      <DS
        num="SECTION 03"
        title="WHO'S BETTING WHAT"
        subtitle="What percentage of traders are betting price goes up (long) vs betting it goes down (short). When too many people are on the same side, the market flips just to punish them. It's not personal — it's math."
        color={GR}
      />

      <div style={{ padding:'20px 24px 32px' }}>
        <div style={{ display:'flex', gap:'4px', marginBottom:'20px', flexWrap:'wrap' }}>
          {[
            { pct:'70%+ LONG', desc:'Crowded. Expect a flush down to liquidate them.', color:RD },
            { pct:'50–60% LONG', desc:'Normal healthy market. Slight upward bias.', color:GR },
            { pct:'70%+ SHORT', desc:'Crowded short. Expect a violent pump to squeeze them.', color:GR },
          ].map(({pct,desc,color})=>(
            <div key={pct} style={{ flex:'1', minWidth:'180px', padding:'14px 16px', background:'#0d0d0d', borderTop:`3px solid ${color}` }}>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color, marginBottom:'6px' }}>{pct}</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', lineHeight:1.5 }}>{desc}</div>
            </div>
          ))}
        </div>

        {Object.keys(lsRatio).length === 0
          ? <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:'#fff', padding:'20px 0' }}>Long/short data unavailable right now.</div>
          : Object.entries(lsRatio)
              .sort((a,b) => Math.abs(b[1]-50) - Math.abs(a[1]-50))
              .map(([sym, longPct]) => {
                const shortPct  = 100 - longPct;
                const fundRate  = data[sym]?.fundRate ?? null;
                const crowdedLong  = longPct > 65;
                const crowdedShort = longPct < 35;

                // Detect conflict: many longs but negative funding (or many shorts but positive)
                const conflict = (crowdedLong && fundRate !== null && fundRate < 0) ||
                                 (crowdedShort && fundRate !== null && fundRate > 0.01);

                let verdict, col;
                if (conflict && crowdedLong && fundRate < 0) {
                  // Lots of longs but shorts paying — mixed signal, explain it
                  verdict = `${longPct.toFixed(0)}% of accounts are long, but funding is negative (${fundRate.toFixed(4)}%) — meaning shorts are actually paying longs right now. The longs are crowded but the funding doesn't confirm danger yet. Watch closely.`;
                  col = OR;
                } else if (conflict && crowdedShort && fundRate > 0.01) {
                  verdict = `${shortPct.toFixed(0)}% of accounts are short, but funding is positive — longs are paying. Mixed signals. Neither side has a clean edge here.`;
                  col = OR;
                } else if (crowdedLong) {
                  verdict = `${longPct.toFixed(0)}% of traders are long. That's a lot of people on one side. If price drops, they all get liquidated at once — which makes the drop much worse.`;
                  col = RD;
                } else if (crowdedShort) {
                  verdict = `${shortPct.toFixed(0)}% of traders are short. If price pumps, they all have to buy back at the same time — which accelerates the pump.`;
                  col = GR;
                } else {
                  verdict = `${longPct.toFixed(0)}% long, ${shortPct.toFixed(0)}% short. Pretty balanced. No extreme crowding in either direction.`;
                  col = 'rgba(255,255,255,0.5)';
                }

                return (
                  <div key={sym} style={{ marginBottom:'4px', padding:'14px 16px', background:'#0d0d0d', border:`1px solid ${col}18` }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px', flexWrap:'wrap', gap:'8px' }}>
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'26px', color:'#fff' }}>{sym.replace('USDT','')}</span>
                      {conflict && (
                        <span style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:OR, padding:'3px 10px', border:`1px solid ${OR}40`, background:`${OR}10`, letterSpacing:'0.08em' }}>
                          MIXED SIGNALS
                        </span>
                      )}
                    </div>
                    <div style={{ display:'flex', height:'10px', gap:'2px', marginBottom:'10px' }}>
                      <div style={{ width:`${longPct}%`, background:crowdedLong&&!conflict?RD:GR, transition:'width 0.5s', position:'relative' }}>
                        {longPct > 25 && <span style={{ position:'absolute', left:'8px', top:'50%', transform:'translateY(-50%)', fontFamily:MONO, fontSize:'8px', fontWeight:700, color:'#000', whiteSpace:'nowrap' }}>LONG {longPct.toFixed(0)}%</span>}
                      </div>
                      <div style={{ flex:1, background:RD+'55', position:'relative' }}>
                        {shortPct > 15 && <span style={{ position:'absolute', right:'6px', top:'50%', transform:'translateY(-50%)', fontFamily:MONO, fontSize:'8px', fontWeight:700, color:'#fff', whiteSpace:'nowrap' }}>SHORT {shortPct.toFixed(0)}%</span>}
                      </div>
                    </div>
                    <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:col, lineHeight:1.6 }}>{verdict}</div>
                    {fundRate !== null && (
                      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:'#fff', marginTop:'6px' }}>
                        Funding rate: <span style={{ color: fundRate>0.01?OR:fundRate<0?GR:'rgba(255,255,255,0.5)' }}>{fundRate>=0?'+':''}{fundRate.toFixed(4)}% per 8h</span>
                      </div>
                    )}
                  </div>
                );
              })
        }
      </div>

      {/* ── SECTION 4: LIQUIDATION ZONES ── */}
      <DS
        num="SECTION 04"
        title="LIQUIDATION ZONES"
        subtitle="When traders borrow money to trade (leverage), they get automatically wiped out if price moves against them too far. These are the price levels where that mass wipeout would happen. Big players know these levels and hunt them."
        color={RD}
      />

      <div style={{ padding:'20px 24px 60px' }}>
        {/* Visual explainer */}
        <div style={{ padding:'16px 20px', background:'#0d0d0d', border:`1px solid ${OR}25`, marginBottom:'20px' }}>
          <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:OR, marginBottom:'8px' }}>How leverage works — simple version</div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {[
              { x:'10x leverage', eg:'You put in $100, you control $1,000', risk:'A 10% drop = you lose everything', color:RD },
              { x:'5x leverage', eg:'You put in $100, you control $500', risk:'A 20% drop = you lose everything', color:OR },
              { x:'2x leverage', eg:'You put in $100, you control $200', risk:'A 50% drop = you lose everything', color:'#FFE500' },
            ].map(({x,eg,risk,color})=>(
              <div key={x} style={{ flex:'1', minWidth:'160px', padding:'12px 14px', background:'rgba(0,0,0,0.4)', borderLeft:`4px solid ${color}` }}>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color, marginBottom:'4px' }}>{x}</div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:'#fff', marginBottom:'4px', lineHeight:1.4 }}>{eg}</div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'13px', color:RD, lineHeight:1.4 }}>{risk}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Liq zones */}
        <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', letterSpacing:'0.1em', marginBottom:'12px' }}>
          ESTIMATED ZONES — Based on funding rate intensity. Not exact, directionally accurate.
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:'4px' }}>
          {sorted.slice(0,12).map(d => {
            if (!d.perpPrice || d.fundRate===null) return null;
            const isLong  = d.fundRate > 0;
            const liqDist = Math.max(5, Math.min(Math.abs(d.fundRate)*500, 15));
            const liqPrice = isLong ? d.perpPrice*(1-liqDist/100) : d.perpPrice*(1+liqDist/100);
            const danger   = liqDist < 8;
            const col      = danger ? RD : liqDist < 12 ? OR : 'rgba(255,255,255,0.4)';

            return (
              <div key={d.symbol} style={{ padding:'16px', background:'#0d0d0d', border:`1px solid ${col}22`, position:'relative' }}>
                <div style={{ position:'absolute', top:0, left:0, right:0, height:'4px', background:col }} />
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'28px', color:'#fff', marginBottom:'4px' }}>{d.sym}</div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:'#fff', marginBottom:'14px' }}>
                  {isLong ? 'Longs would get wiped at:' : 'Shorts would get wiped at:'}
                </div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'32px', color:col, lineHeight:1, marginBottom:'6px' }}>${fmt(liqPrice)}</div>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:col, marginBottom:'12px' }}>
                  {isLong ? '▼' : '▲'} {liqDist.toFixed(1)}% from current price
                </div>
                <div style={{ height:'6px', background:'rgba(255,255,255,0.05)', marginBottom:'10px' }}>
                  <div style={{ height:'100%', width:`${(liqDist/15)*100}%`, background:col }} />
                </div>
                {danger && (
                  <div style={{ padding:'6px 10px', background:`${RD}18`, border:`1px solid ${RD}40` }}>
                    <span style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:RD }}>⚠ CLOSE — a {liqDist.toFixed(0)}% move could cascade</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop:'20px', padding:'16px 20px', border:'1px solid rgba(255,255,255,0.06)', background:'#0d0d0d' }}>
          <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'#fff', lineHeight:1.8 }}>
            These are estimates based on funding rates. Real liquidations depend on each trader's exact entry, leverage, and exchange. Use as a directional guide only. Not financial advice.
          </div>
        </div>
      </div>

      </>}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SENTIMENT PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const useSentimentData = () => {
  const [fng,        setFng]       = useState(null);
  const [trending,   setTrending]  = useState([]);
  const [cgSentiment,setCgSent]    = useState({});
  const [reddit,     setReddit]    = useState([]);
  const [moonshots,  setMoonshots] = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate]= useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.allSettled([

        // Fear & Greed — 30 days history
        fetch('https://api.alternative.me/fng/?limit=30&format=json')
          .then(r=>r.json())
          .then(j=>{ if(j?.data) setFng(j.data); })
          .catch(()=>{}),

        // CoinGecko trending
        fetch('https://api.coingecko.com/api/v3/search/trending')
          .then(r=>r.json())
          .then(j=>{ if(j?.coins) setTrending(j.coins.slice(0,10).map(c=>c.item)); })
          .catch(()=>{}),

        // CoinGecko sentiment for top coins
        Promise.allSettled(
          ['bitcoin','ethereum','solana','ripple','dogecoin','cardano','avalanche-2','injective-protocol','sui']
            .map(id =>
              fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false`)
                .then(r=>r.json())
                .then(j=>({ id, sym: j.symbol?.toUpperCase(), up: j.sentiment_votes_up_percentage, dn: j.sentiment_votes_down_percentage, price_change: j.market_data?.price_change_percentage_24h }))
                .catch(()=>null)
            )
        ).then(results => {
          const map = {};
          results.forEach(r => { if(r.status==='fulfilled'&&r.value) map[r.value.sym] = r.value; });
          setCgSent(map);
        }),

        // Reddit r/cryptocurrency — hot posts
        fetch('https://www.reddit.com/r/cryptocurrency/hot.json?limit=25')
          .then(r=>r.json())
          .then(j=>{
            if(!j?.data?.children) return;
            const posts = j.data.children.map(p=>({
              title:  p.data.title,
              score:  p.data.score,
              comments: p.data.num_comments,
              url:    `https://reddit.com${p.data.permalink}`,
              flair:  p.data.link_flair_text,
              up_ratio: p.data.upvote_ratio,
            })).filter(p => p.score > 10);
            setReddit(posts);
          })
          .catch(()=>{}),

        // Reddit r/CryptoMoonShots — new coins getting attention
        fetch('https://www.reddit.com/r/CryptoMoonShots/hot.json?limit=15')
          .then(r=>r.json())
          .then(j=>{
            if(!j?.data?.children) return;
            setMoonshots(j.data.children.map(p=>({
              title:   p.data.title,
              score:   p.data.score,
              comments:p.data.num_comments,
              url:     `https://reddit.com${p.data.permalink}`,
            })).filter(p=>p.score>5));
          })
          .catch(()=>{}),

      ]);
      setLoading(false);
      setLastUpdate(new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'}));
    };
    load();
    const iv = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(iv);
  }, []);

  return { fng, trending, cgSentiment, reddit, moonshots, loading, lastUpdate };
};

// Scan Reddit post titles for coin mentions
const scanMentions = (posts) => {
  const counts = {};
  const keywords = ['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','BNB','DOT','LINK',
    'MATIC','ARB','OP','INJ','SUI','APT','NEAR','ATOM','KAS','HYPE','MOG','MEW',
    'PEPE','WIF','BONK','SHIB','UNI','AAVE','LTC','TRX'];
  posts.forEach(p => {
    const text = (p.title + ' ').toUpperCase();
    keywords.forEach(kw => {
      // Match word boundary
      const re = new RegExp(`\\b${kw}\\b`);
      if (re.test(text)) counts[kw] = (counts[kw]||0) + 1;
    });
  });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12);
};

// Simple sentiment from title words
const titleSentiment = (title) => {
  const t = title.toLowerCase();
  const bullWords = ['bull','moon','pump','surge','rally','ath','breakout','gain','up','high','buy','accumulate','launch','soar','rise','rocket','explode','massive'];
  const bearWords = ['bear','dump','crash','fall','drop','down','sell','fear','panic','low','rug','scam','dead','fail','collapse','correction','bleed'];
  let score = 0;
  bullWords.forEach(w => { if(t.includes(w)) score++; });
  bearWords.forEach(w => { if(t.includes(w)) score--; });
  return score;
};

const SentimentPage = ({ coins, techMap }) => {
  const { fng, trending, cgSentiment, reddit, moonshots, loading, lastUpdate } = useSentimentData();

  const allReddit = [...reddit, ...moonshots];
  const mentions  = useMemo(() => scanMentions(allReddit), [allReddit]);

  // Overall Reddit mood from post titles
  const redditMood = useMemo(() => {
    if (!reddit.length) return null;
    const scores = reddit.map(p => titleSentiment(p.title));
    const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
    const bullPosts = scores.filter(s=>s>0).length;
    const bearPosts = scores.filter(s=>s<0).length;
    return { avg, bullPosts, bearPosts, total: reddit.length };
  }, [reddit]);

  // Current F&G
  const currentFng = fng?.[0];
  const fngHistory = fng?.slice(0,14) || [];
  const fngColor = (val) => {
    const v = parseInt(val);
    if (v >= 75) return '#FF2D55';  // Extreme Greed — danger
    if (v >= 55) return '#F5A200';  // Greed
    if (v >= 45) return '#FFE500';  // Neutral
    if (v >= 25) return '#CCFF00';  // Fear — opportunity
    return '#CCFF00';               // Extreme Fear — big opportunity
  };
  const fngExplain = (val, cls) => {
    if (cls === 'Extreme Greed') return 'Everyone is euphoric. Historically the worst time to buy. The market is over-leveraged and over-hyped.';
    if (cls === 'Greed')         return 'Market is feeling confident and pushing higher. Good time to manage risk — not a top signal alone, but stay alert.';
    if (cls === 'Neutral')       return 'No strong lean either way. Market is undecided. Wait for a clearer signal before making big moves.';
    if (cls === 'Fear')          return 'People are scared. Historically fear zones are where the best buying opportunities appear. Confirm with price structure.';
    return                              'Extreme panic. Blood in the streets. Historically the best time to accumulate quality assets with strong fundamentals.';
  };

  const SHead = ({ num, title, sub, color=OR }) => (
    <div style={{ padding:'28px 24px 0' }}>
      <div style={{ fontFamily:MONO, fontSize:'11px', color, letterSpacing:'0.3em', marginBottom:'6px', opacity:0.8 }}>{num}</div>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(26px,4vw,36px)', color:'#fff', letterSpacing:'0.02em', lineHeight:1, marginBottom:'8px' }}>{title}</div>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:'rgba(255,255,255,0.5)', lineHeight:1.6, maxWidth:'600px', paddingBottom:'20px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>{sub}</div>
    </div>
  );

  if (loading) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(40px,8vw,80px)', color:'rgba(255,255,255,0.04)' }}>SENTIMENT</div>
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <div style={{ width:'10px', height:'10px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:OR, letterSpacing:'0.14em' }}>PULLING SOCIAL DATA_</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>

      {/* Masthead */}
      <div style={{ padding:'28px 24px 24px', borderBottom:`3px solid ${OR}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:'11px', color:OR, letterSpacing:'0.4em', marginBottom:'8px', opacity:0.7 }}>// SOCIAL + MARKET SENTIMENT · LIVE</div>
            <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(52px,10vw,100px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em' }}>
              SENTIMENT<br/><span style={{ color:OR }}>INTEL</span>
            </h1>
          </div>
          <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', textAlign:'right', lineHeight:2, letterSpacing:'0.1em' }}>
            {lastUpdate && <div style={{ color:OR }}>UPDATED {lastUpdate}</div>}
            <div>FEAR & GREED · REDDIT · COINGECKO</div>
            <div>REFRESHES EVERY 5 MIN</div>
          </div>
        </div>
      </div>

      {/* ── SECTION 1: FEAR & GREED ── */}
      <SHead num="SIGNAL 01" title="FEAR & GREED INDEX" color={OR}
        sub="Crypto-specific index from alternative.me. Measures Bitcoin volatility, market momentum, social volume, dominance and Google Trends. Different from stock market fear & greed indexes — this is crypto only. Extreme Fear = panic, historically good to buy. Extreme Greed = euphoria, historically dangerous." />

      {currentFng && (
        <div style={{ padding:'24px' }}>
          {/* Big score display */}
          <div style={{ display:'flex', gap:'2px', flexWrap:'wrap', marginBottom:'20px' }}>
            <div style={{ flex:'1', minWidth:'200px', padding:'24px', background:'#0d0d0d', borderTop:`4px solid ${fngColor(currentFng.value)}` }}>
              <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'8px' }}>TODAY'S SCORE — CRYPTO ONLY</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(80px,14vw,120px)', color:fngColor(currentFng.value), lineHeight:0.85, letterSpacing:'-0.02em' }}>
                {currentFng.value}
              </div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'28px', color:fngColor(currentFng.value), marginTop:'8px', letterSpacing:'0.04em' }}>
                {currentFng.value_classification.toUpperCase()}
              </div>
              {currentFng.time_until_update && (
                <div style={{ fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.3)', marginTop:'8px', letterSpacing:'0.1em' }}>
                  Updates in {Math.floor(parseInt(currentFng.time_until_update)/3600)}h {Math.floor((parseInt(currentFng.time_until_update)%3600)/60)}m
                </div>
              )}
            </div>
            <div style={{ flex:'2', minWidth:'280px', padding:'24px', background:'#0d0d0d' }}>
              <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'12px' }}>WHAT THIS MEANS</div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'18px', color:'#fff', lineHeight:1.7, marginBottom:'16px' }}>
                {fngExplain(currentFng.value, currentFng.value_classification)}
              </div>
              {/* Scale */}
              <div style={{ display:'flex', gap:'0', marginTop:'8px' }}>
                {[
                  { label:'EXTREME\nFEAR', range:'0-24', color:'#CCFF00' },
                  { label:'FEAR', range:'25-44', color:'#88CC00' },
                  { label:'NEUTRAL', range:'45-55', color:'#FFE500' },
                  { label:'GREED', range:'56-75', color:'#F5A200' },
                  { label:'EXTREME\nGREED', range:'76-100', color:'#FF2D55' },
                ].map(s => {
                  const active = (
                    (s.range==='0-24' && currentFng.value<=24) ||
                    (s.range==='25-44' && currentFng.value>=25&&currentFng.value<=44) ||
                    (s.range==='45-55' && currentFng.value>=45&&currentFng.value<=55) ||
                    (s.range==='56-75' && currentFng.value>=56&&currentFng.value<=75) ||
                    (s.range==='76-100'&& currentFng.value>=76)
                  );
                  return (
                    <div key={s.range} style={{ flex:1, padding:'8px 6px', borderTop:`3px solid ${active?s.color:'rgba(255,255,255,0.08)'}`, background:active?`${s.color}12`:'transparent', textAlign:'center' }}>
                      <div style={{ fontFamily:MONO, fontSize:'8px', color:active?s.color:'rgba(255,255,255,0.3)', fontWeight:700, letterSpacing:'0.06em', lineHeight:1.4, whiteSpace:'pre-line' }}>{s.label}</div>
                      <div style={{ fontFamily:MONO, fontSize:'8px', color:active?s.color:'rgba(255,255,255,0.2)', marginTop:'3px' }}>{s.range}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 14-day history */}
          <div style={{ background:'#0d0d0d', padding:'16px 20px' }}>
            <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'14px' }}>14-DAY HISTORY</div>
            <div style={{ display:'flex', gap:'3px', alignItems:'flex-end', height:'80px' }}>
              {[...fngHistory].reverse().map((d,i) => {
                const h = (parseInt(d.value) / 100) * 72;
                const col = fngColor(d.value);
                const isToday = i === fngHistory.length-1;
                return (
                  <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' }}>
                    <div style={{ width:'100%', height:`${h}px`, background:col, opacity:isToday?1:0.45, minHeight:'4px', position:'relative' }}>
                      {isToday && <div style={{ position:'absolute', top:'-20px', left:'50%', transform:'translateX(-50%)', fontFamily:MONO, fontSize:'8px', color:col, fontWeight:700, whiteSpace:'nowrap' }}>TODAY</div>}
                    </div>
                    <div style={{ fontFamily:MONO, fontSize:'7px', color:'rgba(255,255,255,0.3)', whiteSpace:'nowrap' }}>{parseInt(d.value)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2: COINGECKO TRENDING ── */}
      <SHead num="SIGNAL 02" title="WHAT'S TRENDING" color='#FFE500'
        sub="The 10 most searched coins on CoinGecko right now. Trending doesn't mean bullish — it just means people are looking. High search volume can mean interest is building, or panic, or both. Cross-reference with the scanner before acting." />

      {trending.length > 0 && (
        <div style={{ padding:'20px 24px 28px' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
            {trending.map((coin, i) => {
              const rank = i + 1;
              const hasTech = techMap[coin.symbol?.toUpperCase()+'USDT'];
              const momentum = hasTech?.momentum;
              const momCol = momentum>=70?'#CCFF00':momentum>=45?'#F5A200':momentum>=25?'#FFE500':'#FF2D55';
              return (
                <div key={coin.id} style={{ flex:'1', minWidth:'160px', padding:'14px 16px', background:'#0d0d0d', borderTop:`3px solid ${rank<=3?'#FFE500':'rgba(255,255,255,0.1)'}` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
                    <span style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.3)' }}>#{rank}</span>
                    {rank <= 3 && <span style={{ fontFamily:MONO, fontSize:'10px', color:'#FFE500', fontWeight:700 }}>HOT</span>}
                  </div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'24px', color:'#fff', lineHeight:1, marginBottom:'4px' }}>{coin.symbol?.toUpperCase()}</div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'14px', color:'rgba(255,255,255,0.5)', marginBottom:'6px' }}>{coin.name}</div>
                  {momentum !== undefined && (
                    <div style={{ fontFamily:MONO, fontSize:'10px', color:momCol, fontWeight:700 }}>Score {momentum}/100</div>
                  )}
                  {!hasTech && (
                    <div style={{ fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>Not in scanner</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SECTION 3: COMMUNITY SENTIMENT ── */}
      <SHead num="SIGNAL 03" title="COMMUNITY VOTES" color={GR}
        sub="CoinGecko's community sentiment — real users voting bullish or bearish on each coin. Not a trading signal on its own, but extreme readings (90%+ bull or bear) often precede reversals. When everyone agrees, the market loves to disagree." />

      <div style={{ padding:'20px 24px 28px' }}>
        {Object.keys(cgSentiment).length === 0
          ? <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:'rgba(255,255,255,0.3)' }}>Loading community data...</div>
          : Object.entries(cgSentiment)
              .filter(([,d]) => d.up != null)
              .sort((a,b) => b[1].up - a[1].up)
              .map(([sym, d]) => {
                const upPct   = d.up?.toFixed(0);
                const dnPct   = d.dn?.toFixed(0);
                const extreme = d.up >= 85 || d.up <= 35;
                const col     = d.up >= 65 ? GR : d.up >= 50 ? OR : RD;
                const verdict = d.up >= 85 ? `${upPct}% bullish — crowd is extremely one-sided. Contrarian watch.`
                              : d.up >= 65 ? `${upPct}% bullish — community leaning positive.`
                              : d.up >= 50 ? `${upPct}% bullish — mild positive lean.`
                              : d.up < 35  ? `Only ${upPct}% bullish — community is very bearish. Potential contrarian signal.`
                              : `${upPct}% bullish — slightly bearish community lean.`;
                return (
                  <div key={sym} style={{ marginBottom:'4px', padding:'12px 16px', background:'#0d0d0d', border:`1px solid ${col}18` }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px', flexWrap:'wrap', gap:'8px' }}>
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff' }}>{sym}</span>
                      {extreme && <span style={{ fontFamily:MONO, fontSize:'10px', color:OR, padding:'2px 8px', border:`1px solid ${OR}40`, fontWeight:700 }}>EXTREME — WATCH FOR REVERSAL</span>}
                      <span style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:col }}>{verdict}</span>
                    </div>
                    <div style={{ display:'flex', height:'10px', gap:'2px' }}>
                      <div style={{ width:`${d.up}%`, background:GR, transition:'width 0.5s', position:'relative' }}>
                        {d.up > 25 && <span style={{ position:'absolute', left:'8px', top:'50%', transform:'translateY(-50%)', fontFamily:MONO, fontSize:'8px', fontWeight:700, color:'#000', whiteSpace:'nowrap' }}>BULL {upPct}%</span>}
                      </div>
                      <div style={{ flex:1, background:`${RD}66`, position:'relative' }}>
                        {d.dn > 15 && <span style={{ position:'absolute', right:'6px', top:'50%', transform:'translateY(-50%)', fontFamily:MONO, fontSize:'8px', fontWeight:700, color:'rgba(255,255,255,0.7)', whiteSpace:'nowrap' }}>BEAR {dnPct}%</span>}
                      </div>
                    </div>
                  </div>
                );
              })
        }
      </div>

      {/* ── SECTION 4: REDDIT PULSE ── */}
      <SHead num="SIGNAL 04" title="REDDIT PULSE" color={RD}
        sub="What r/cryptocurrency is actually talking about right now. Most mentioned coins, top posts by score, and overall mood from post titles. Reddit is retail — it tends to get loudest right before a move ends. Use it as a contrarian signal." />

      <div style={{ padding:'20px 24px 28px' }}>

        {/* Coin mentions */}
        {mentions.length > 0 && (
          <div style={{ marginBottom:'24px' }}>
            <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'14px' }}>MOST MENTIONED COINS (r/cryptocurrency + r/CryptoMoonShots)</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:'4px' }}>
              {mentions.map(([sym, count], i) => {
                const hasTech = techMap[sym+'USDT'];
                const momCol = hasTech?.momentum>=70?'#CCFF00':hasTech?.momentum>=45?'#F5A200':'rgba(255,255,255,0.4)';
                const isTop = i < 3;
                return (
                  <div key={sym} style={{ padding:'10px 14px', background:'#0d0d0d', borderTop:`3px solid ${isTop?OR:'rgba(255,255,255,0.08)'}`, minWidth:'90px', flex:1 }}>
                    <div style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color:'#fff', lineHeight:1 }}>{sym}</div>
                    <div style={{ fontFamily:MONO, fontSize:'11px', color:isTop?OR:'rgba(255,255,255,0.4)', marginTop:'4px', fontWeight:700 }}>{count} mention{count!==1?'s':''}</div>
                    {hasTech && <div style={{ fontFamily:MONO, fontSize:'10px', color:momCol, marginTop:'2px' }}>Score {hasTech.momentum}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reddit mood */}
        {redditMood && (
          <div style={{ padding:'16px 20px', background:'#0d0d0d', marginBottom:'20px', borderLeft:`4px solid ${redditMood.avg>0?GR:redditMood.avg<0?RD:OR}` }}>
            <div style={{ fontFamily:MONO, fontSize:'11px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'8px' }}>REDDIT MOOD FROM POST TITLES</div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'20px', color:'#fff', marginBottom:'6px' }}>
              {redditMood.bullPosts} bullish posts · {redditMood.bearPosts} bearish posts · {redditMood.total - redditMood.bullPosts - redditMood.bearPosts} neutral
            </div>
            <div style={{ fontFamily:COND, fontWeight:900, fontSize:'15px', color:redditMood.avg>0?GR:redditMood.avg<0?RD:OR }}>
              {redditMood.avg > 0.3 ? 'Reddit is feeling bullish right now. High retail excitement — stay contrarian-aware.'
               : redditMood.avg < -0.3 ? 'Reddit is feeling bearish/scared. Retail panic can signal opportunity — check your scanner.'
               : 'Reddit is neutral. No strong emotional lean in either direction.'}
            </div>
          </div>
        )}

        {/* Top Reddit posts */}
        {reddit.slice(0,10).map((post, i) => {
          const mood = titleSentiment(post.title);
          const col  = mood > 0 ? GR : mood < 0 ? RD : 'rgba(255,255,255,0.4)';
          return (
            <div key={i} style={{ padding:'12px 0', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', gap:'14px', alignItems:'flex-start' }}>
              <div style={{ width:'4px', alignSelf:'stretch', background:col, flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:'#fff', lineHeight:1.4, marginBottom:'4px' }}>{post.title}</div>
                <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
                  <span style={{ fontFamily:MONO, fontSize:'10px', color:OR, fontWeight:700 }}>▲ {post.score.toLocaleString()}</span>
                  <span style={{ fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.4)' }}>{post.comments} comments</span>
                  {post.flair && <span style={{ fontFamily:MONO, fontSize:'9px', color:'rgba(255,255,255,0.4)', padding:'1px 6px', border:'1px solid rgba(255,255,255,0.1)' }}>{post.flair}</span>}
                  <span style={{ fontFamily:MONO, fontSize:'10px', color:col, fontWeight:700 }}>{mood>0?'BULLISH TITLE':mood<0?'BEARISH TITLE':'NEUTRAL'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding:'16px 24px', borderTop:`2px solid ${OR}`, fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.3)', letterSpacing:'0.12em', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px' }}>
        <span>SENTIMENT IS NOT A TRADING SIGNAL · ALWAYS CONFIRM WITH PRICE + STRUCTURE</span>
        <span style={{ color:`${OR}60` }}>SOURCES: ALTERNATIVE.ME · COINGECKO · REDDIT</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const NEWS_SOURCES = [
  { id:'coindesk',     name:'CoinDesk',         url:'https://www.coindesk.com/arc/outboundfeeds/rss/',  color:'#F5A200' },
  { id:'cointelegraph',name:'CoinTelegraph',     url:'https://cointelegraph.com/rss',                    color:'#CCFF00' },
  { id:'decrypt',      name:'Decrypt',           url:'https://decrypt.co/feed',                          color:'#00C8FF' },
  { id:'theblock',     name:'The Block',         url:'https://www.theblock.co/rss.xml',                  color:'#FF2D55' },
  { id:'blockworks',   name:'Blockworks',        url:'https://blockworks.co/feed',                       color:'#9B59FF' },
  { id:'bitcoinmag',   name:'Bitcoin Magazine',  url:'https://bitcoinmagazine.com/.rss/full/',            color:'#F5A200' },
  { id:'cryptoslate',  name:'CryptoSlate',       url:'https://cryptoslate.com/feed/',                    color:'#FFE500' },
];

const RSS2JSON = 'https://api.rss2json.com/v1/api.json?rss_url=';

// Keywords to detect coin mentions in headlines
const COIN_KEYWORDS = {
  BTC:['bitcoin','btc'], ETH:['ethereum','eth'], SOL:['solana','sol'],
  XRP:['xrp','ripple'], DOGE:['dogecoin','doge'], BNB:['bnb','binance'],
  ADA:['cardano','ada'], AVAX:['avalanche','avax'], DOT:['polkadot','dot'],
  LINK:['chainlink','link'], MATIC:['polygon','matic'], ARB:['arbitrum','arb'],
  OP:['optimism',' op '], INJ:['injective','inj'], SUI:['sui'], APT:['aptos','apt'],
  NEAR:['near protocol','near'], ATOM:['cosmos','atom'], UNI:['uniswap','uni'],
  KAS:['kaspa','kas'], HYPE:['hyperliquid','hype'], XMR:['monero','xmr'],
  PEPE:['pepe'], WIF:['dogwifhat','wif'], SHIB:['shiba','shib'],
};

const detectCoins = (text) => {
  const lower = text.toLowerCase();
  return Object.entries(COIN_KEYWORDS)
    .filter(([,words]) => words.some(w => lower.includes(w)))
    .map(([sym]) => sym);
};

const newsTimestamp = (dateStr) => {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
};

const headlineSentiment = (title) => {
  const t = title.toLowerCase();
  const bull = ['surge','rally','bull','ath','record','high','pump','gain','rise','soar','launch','partnership','adoption','upgrade','approve','win','growth','up','moon','break'];
  const bear = ['crash','dump','bear','low','fall','drop','hack','scam','ban','sue','sec','lawsuit','warning','fear','panic','sell','down','collapse','fraud','fine','lose','stolen'];
  let s = 0;
  bull.forEach(w => { if(t.includes(w)) s++; });
  bear.forEach(w => { if(t.includes(w)) s--; });
  return s > 0 ? 'bull' : s < 0 ? 'bear' : 'neutral';
};

const useNewsData = () => {
  const [articles,   setArticles]   = useState([]);
  const [bySource,   setBySource]   = useState({});
  const [loading,    setLoading]    = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const results = await Promise.allSettled(
        NEWS_SOURCES.map(src =>
          fetch(`${RSS2JSON}${encodeURIComponent(src.url)}`)
            .then(r => r.json())
            .then(j => {
              if (j.status !== 'ok' || !j.items?.length) return null;
              return {
                source: src,
                items: j.items.map(item => ({
                  title:     item.title?.trim(),
                  link:      item.link,
                  pubDate:   item.pubDate,
                  thumbnail: item.thumbnail || item.enclosure?.link || null,
                  coins:     detectCoins(item.title + ' ' + (item.description||'')),
                  sentiment: headlineSentiment(item.title||''),
                  source:    src.id,
                  sourceName:src.name,
                  sourceColor:src.color,
                }))
              };
            })
            .catch(() => null)
        )
      );

      const sourceMap = {};
      const all = [];
      results.forEach(r => {
        if (r.status !== 'fulfilled' || !r.value) return;
        const { source, items } = r.value;
        sourceMap[source.id] = items;
        all.push(...items);
      });

      // Sort all by date, newest first
      all.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));

      setArticles(all);
      setBySource(sourceMap);
      setLoading(false);
      setLastUpdate(new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit'}));
    };
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, []);

  return { articles, bySource, loading, lastUpdate };
};

const NewsPage = ({ coins, techMap }) => {
  const { articles, bySource, loading, lastUpdate } = useNewsData();
  const [activeSource, setActiveSource] = useState('ALL');
  const [activeCoin,   setActiveCoin]   = useState(null);
  const [sentFilter,   setSentFilter]   = useState('ALL');

  // Coin mention counts from all headlines
  const coinMentions = useMemo(() => {
    const counts = {};
    articles.forEach(a => a.coins.forEach(c => { counts[c] = (counts[c]||0)+1; }));
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,16);
  }, [articles]);

  // Filtered articles
  const filtered = useMemo(() => {
    let list = articles;
    if (activeSource !== 'ALL') list = list.filter(a => a.source === activeSource);
    if (activeCoin) list = list.filter(a => a.coins.includes(activeCoin));
    if (sentFilter !== 'ALL') list = list.filter(a => a.sentiment === sentFilter.toLowerCase());
    return list.slice(0, 60);
  }, [articles, activeSource, activeCoin, sentFilter]);

  const sentCounts = useMemo(() => ({
    bull:    articles.filter(a=>a.sentiment==='bull').length,
    bear:    articles.filter(a=>a.sentiment==='bear').length,
    neutral: articles.filter(a=>a.sentiment==='neutral').length,
  }), [articles]);

  if (loading) return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'20px' }}>
      <div style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(40px,8vw,80px)', color:'rgba(255,255,255,0.04)' }}>NEWS</div>
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <div style={{ width:'10px', height:'10px', background:OR, animation:'blink 1s ease infinite' }} />
        <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:OR, letterSpacing:'0.14em' }}>PULLING LATEST CRYPTO NEWS_</span>
      </div>
    </div>
  );

  return (
    <div style={{ background:'#0a0a0a', minHeight:'100vh' }}>

      {/* Masthead */}
      <div style={{ padding:'28px 24px 20px', borderBottom:`3px solid ${OR}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'12px' }}>
          <div>
            <div style={{ fontFamily:MONO, fontSize:'11px', color:OR, letterSpacing:'0.4em', marginBottom:'8px', opacity:0.7 }}>// LIVE CRYPTO NEWS · 7 SOURCES</div>
            <h1 style={{ fontFamily:COND, fontWeight:900, fontSize:'clamp(52px,10vw,100px)', lineHeight:0.82, color:'#fff', letterSpacing:'-0.01em' }}>
              CRYPTO<br/><span style={{ color:OR }}>NEWS</span>
            </h1>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', alignItems:'flex-end' }}>
            {lastUpdate && <div style={{ fontFamily:MONO, fontSize:'11px', color:OR, letterSpacing:'0.1em' }}>UPDATED {lastUpdate}</div>}
            <div style={{ display:'flex', gap:'4px' }}>
              {[
                { label:'BULLISH', count:sentCounts.bull,    color:GR },
                { label:'BEARISH', count:sentCounts.bear,    color:RD },
                { label:'NEUTRAL', count:sentCounts.neutral, color:'rgba(255,255,255,0.4)' },
              ].map(({label,count,color})=>(
                <div key={label} style={{ padding:'6px 12px', background:'#0d0d0d', border:`1px solid ${color}25` }}>
                  <div style={{ fontFamily:MONO, fontSize:'9px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.12em', marginBottom:'2px' }}>{label}</div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color, lineHeight:1 }}>{count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Coin mention strip */}
      {coinMentions.length > 0 && (
        <div style={{ borderBottom:'1px solid rgba(255,255,255,0.06)', padding:'12px 24px', background:'#0d0d0d' }}>
          <div style={{ fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.4)', letterSpacing:'0.2em', marginBottom:'10px' }}>MOST MENTIONED IN HEADLINES</div>
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            {coinMentions.map(([sym, count]) => {
              const isActive = activeCoin === sym;
              const hasTech  = techMap[sym+'USDT'];
              const momCol   = hasTech?.momentum>=70?GR:hasTech?.momentum>=45?OR:'rgba(255,255,255,0.4)';
              return (
                <button key={sym} onClick={()=>setActiveCoin(isActive?null:sym)} style={{
                  all:'unset', cursor:'pointer',
                  padding:'6px 12px', border:`1px solid ${isActive?OR:'rgba(255,255,255,0.1)'}`,
                  background: isActive?`${OR}15`:'transparent',
                  transition:'all 0.1s',
                }}>
                  <span style={{ fontFamily:COND, fontWeight:900, fontSize:'16px', color:isActive?OR:'#fff' }}>{sym}</span>
                  <span style={{ fontFamily:MONO, fontSize:'9px', color:isActive?OR:'rgba(255,255,255,0.4)', marginLeft:'6px' }}>{count}</span>
                  {hasTech && <span style={{ fontFamily:MONO, fontSize:'8px', color:momCol, marginLeft:'4px' }}>·{hasTech.momentum}</span>}
                </button>
              );
            })}
            {activeCoin && (
              <button onClick={()=>setActiveCoin(null)} style={{ all:'unset', cursor:'pointer', padding:'6px 12px', border:'1px solid rgba(255,45,85,0.4)', color:RD, fontFamily:MONO, fontSize:'10px' }}>
                ✕ CLEAR
              </button>
            )}
          </div>
        </div>
      )}

      {/* Source + sentiment filter bar */}
      <div style={{ borderBottom:'1px solid rgba(255,255,255,0.06)', padding:'10px 24px', display:'flex', gap:'12px', flexWrap:'wrap', alignItems:'center', background:'#0a0a0a' }}>
        {/* Source tabs */}
        <div style={{ display:'flex', gap:'3px', flexWrap:'wrap' }}>
          <button onClick={()=>setActiveSource('ALL')} style={{
            all:'unset', cursor:'pointer', padding:'5px 12px',
            fontFamily:MONO, fontSize:'10px', fontWeight:700, letterSpacing:'0.1em',
            color: activeSource==='ALL'?'#000':'rgba(255,255,255,0.5)',
            background: activeSource==='ALL'?OR:'transparent',
            border:`1px solid ${activeSource==='ALL'?OR:'rgba(255,255,255,0.1)'}`,
          }}>ALL ({articles.length})</button>
          {NEWS_SOURCES.map(src => {
            const count = bySource[src.id]?.length || 0;
            const active = activeSource === src.id;
            return (
              <button key={src.id} onClick={()=>setActiveSource(active?'ALL':src.id)} style={{
                all:'unset', cursor:'pointer', padding:'5px 12px',
                fontFamily:MONO, fontSize:'10px', fontWeight:700, letterSpacing:'0.08em',
                color: active?'#000':src.color,
                background: active?src.color:'transparent',
                border:`1px solid ${active?src.color:src.color+'40'}`,
                transition:'all 0.1s',
              }}>{src.name} {count>0?`(${count})`:''}</button>
            );
          })}
        </div>

        {/* Sentiment filter */}
        <div style={{ display:'flex', gap:'3px', marginLeft:'auto' }}>
          {[
            {key:'ALL',    label:'ALL',     color:'rgba(255,255,255,0.5)'},
            {key:'BULL',   label:'BULLISH', color:GR},
            {key:'BEAR',   label:'BEARISH', color:RD},
            {key:'NEUTRAL',label:'NEUTRAL', color:'rgba(255,255,255,0.4)'},
          ].map(({key,label,color})=>(
            <button key={key} onClick={()=>setSentFilter(key)} style={{
              all:'unset', cursor:'pointer', padding:'5px 10px',
              fontFamily:MONO, fontSize:'9px', fontWeight:700, letterSpacing:'0.1em',
              color: sentFilter===key?'#000':color,
              background: sentFilter===key?color:'transparent',
              border:`1px solid ${sentFilter===key?color:color+'50'}`,
              transition:'all 0.1s',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* News feed */}
      <div style={{ padding:'0 24px 60px' }}>
        {filtered.length === 0 ? (
          <div style={{ padding:'60px 0', fontFamily:COND, fontWeight:900, fontSize:'20px', color:'rgba(255,255,255,0.2)', textAlign:'center' }}>
            NO ARTICLES MATCH YOUR FILTERS
          </div>
        ) : filtered.map((article, i) => {
          const sentCol = article.sentiment==='bull'?GR : article.sentiment==='bear'?RD : 'rgba(255,255,255,0.2)';
          const sentLabel = article.sentiment==='bull'?'BULLISH' : article.sentiment==='bear'?'BEARISH' : 'NEUTRAL';
          const isBreaking = i < 3 && activeSource==='ALL';

          return (
            <div key={i} style={{
              borderBottom:'1px solid rgba(255,255,255,0.05)',
              padding:'16px 0',
              display:'flex', gap:'16px', alignItems:'flex-start',
              background: isBreaking?`${article.sourceColor}05`:'transparent',
            }}>
              {/* Left accent */}
              <div style={{ width:'4px', alignSelf:'stretch', background:sentCol, flexShrink:0, opacity:0.6 }} />

              <div style={{ flex:1, minWidth:0 }}>
                {/* Top row: source + time + sentiment */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px', flexWrap:'wrap' }}>
                  <span style={{ fontFamily:MONO, fontSize:'10px', color:article.sourceColor, fontWeight:700, letterSpacing:'0.1em' }}>
                    {article.sourceName}
                  </span>
                  <span style={{ fontFamily:MONO, fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>
                    {newsTimestamp(article.pubDate)}
                  </span>
                  <span style={{ fontFamily:MONO, fontSize:'9px', color:sentCol, padding:'1px 6px', border:`1px solid ${sentCol}40`, fontWeight:700 }}>
                    {sentLabel}
                  </span>
                  {isBreaking && (
                    <span style={{ fontFamily:MONO, fontSize:'9px', color:OR, padding:'1px 6px', border:`1px solid ${OR}50`, fontWeight:700, animation:'blink 2s ease infinite' }}>
                      LATEST
                    </span>
                  )}
                  {/* Coin tags */}
                  {article.coins.slice(0,4).map(sym => {
                    const hasTech = techMap[sym+'USDT'];
                    const col = hasTech?.momentum>=70?GR:hasTech?.momentum>=45?OR:'rgba(255,255,255,0.4)';
                    return (
                      <button key={sym} onClick={()=>setActiveCoin(activeCoin===sym?null:sym)} style={{
                        all:'unset', cursor:'pointer',
                        fontFamily:MONO, fontSize:'9px', color:col, fontWeight:700,
                        padding:'1px 6px', border:`1px solid ${col}40`,
                        background: activeCoin===sym?`${col}15`:'transparent',
                      }}>{sym}</button>
                    );
                  })}
                </div>

                {/* Headline */}
                <a href={article.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none' }}>
                  <div style={{
                    fontFamily:COND, fontWeight:900,
                    fontSize: isBreaking ? '22px' : '18px',
                    color:'#fff', lineHeight:1.3,
                    letterSpacing:'0.01em',
                    transition:'color 0.1s',
                  }}
                  onMouseEnter={e=>e.currentTarget.style.color=OR}
                  onMouseLeave={e=>e.currentTarget.style.color='#fff'}
                  >
                    {article.title}
                  </div>
                </a>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};

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

// ── NAV MENU — hamburger on mobile, inline on desktop ──────────────────────
const NAV_ITEMS = [
  { key:'SCANNER',   label:'SCANNER',      icon:'◈' },
  { key:'LABS',      label:'ALPHA SECTOR', icon:'⚗' },
  { key:'WAR',       label:'WAR ROOM',     icon:'⚔' },
  { key:'EDGE',      label:'THE EDGE',     icon:'◉' },
  { key:'DERIV',     label:'DERIVATIVES',  icon:'◆' },
  { key:'SENTIMENT', label:'SENTIMENT',    icon:'◎' },
  { key:'NEWS',      label:'NEWS',         icon:'◍' },
];

const NavMenu = ({ page, setPage }) => {
  const [open, setOpen] = useState(false);

  const handleNav = (key) => { setPage(key); setOpen(false); };

  return (
    <>
      {/* Hamburger button — always visible, replaces inline nav */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          all:'unset', cursor:'pointer', flexShrink:0,
          display:'flex', flexDirection:'column', gap:'5px',
          padding:'8px 10px',
          border:`1px solid ${open ? '#F5A200' : 'rgba(245,162,0,0.35)'}`,
          background: open ? 'rgba(245,162,0,0.1)' : 'transparent',
          transition:'all 0.1s',
        }}
        aria-label="Menu"
      >
        <span style={{ display:'block', width:'20px', height:'2px', background: open ? '#F5A200' : '#F5A200', transition:'all 0.2s', transform: open ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
        <span style={{ display:'block', width:'20px', height:'2px', background:'#F5A200', transition:'all 0.2s', opacity: open ? 0 : 1 }} />
        <span style={{ display:'block', width:'20px', height:'2px', background: open ? '#F5A200' : '#F5A200', transition:'all 0.2s', transform: open ? 'rotate(-45deg) translate(5px, -5px)' : 'none' }} />
      </button>

      {/* Current page indicator next to hamburger */}
      <div style={{ fontFamily:MONO, fontSize:'10px', color:'#F5A200', fontWeight:700, letterSpacing:'0.12em', flexShrink:0 }}>
        {NAV_ITEMS.find(n=>n.key===page)?.icon} {NAV_ITEMS.find(n=>n.key===page)?.label}
      </div>

      {/* Dropdown — full width, slides down */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position:'fixed', inset:0, zIndex:290, background:'rgba(0,0,0,0.6)' }}
          />
          {/* Menu panel */}
          <div style={{
            position:'fixed', top:'48px', right:0, left:0, zIndex:295,
            background:'#0a0a0a', borderBottom:`3px solid #F5A200`,
            animation:'fadein 0.15s ease',
          }}>
            {NAV_ITEMS.map(({ key, label, icon }) => {
              const active = page === key;
              return (
                <button
                  key={key}
                  onClick={() => handleNav(key)}
                  style={{
                    all:'unset', cursor:'pointer', display:'flex',
                    alignItems:'center', gap:'14px', width:'100%',
                    padding:'16px 24px',
                    borderBottom:'1px solid rgba(255,255,255,0.06)',
                    background: active ? 'rgba(245,162,0,0.08)' : 'transparent',
                    borderLeft: active ? '4px solid #F5A200' : '4px solid transparent',
                    transition:'all 0.1s',
                    boxSizing:'border-box',
                  }}
                  onMouseEnter={e => { if(!active) e.currentTarget.style.background='rgba(245,162,0,0.04)'; }}
                  onMouseLeave={e => { if(!active) e.currentTarget.style.background='transparent'; }}
                >
                  <span style={{ fontFamily:MONO, fontSize:'16px', color: active ? '#F5A200' : 'rgba(255,255,255,0.3)', width:'24px', flexShrink:0 }}>{icon}</span>
                  <span style={{ fontFamily:COND, fontWeight:900, fontSize:'22px', color: active ? '#F5A200' : '#fff', letterSpacing:'0.08em', textTransform:'uppercase' }}>{label}</span>
                  {active && <span style={{ fontFamily:MONO, fontSize:'10px', color:'#F5A200', marginLeft:'auto', letterSpacing:'0.14em' }}>ACTIVE</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
};

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
  const [page,     setPage]     = useState('SCANNER');
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
    const loadAll = async () => {
      try {
        // ── Binance fetch ──
        const bnData = await fetch('https://api.binance.com/api/v3/ticker/24hr').then(r=>r.json());
        const byVol = bnData
          .filter(p => p.symbol.endsWith('USDT') && parseFloat(p.quoteVolume) > 1e6 && !DENYLIST.has(p.symbol))
          .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
          .slice(0, 193)
          .map(p => p.symbol);

        const symSet  = new Set([...PINNED, ...byVol]);
        const bnSyms  = [...symSet].slice(0, 200);

        const bnCoins = bnSyms.map(sym => {
          const p = bnData.find(x => x.symbol === sym) || {};
          return {
            symbol:  sym,
            display: sym.replace('USDT', ''),
            price:   parseFloat(p.lastPrice || 0),
            vol:     parseFloat(p.quoteVolume || 0),
            ch:      parseFloat(p.priceChangePercent || 0),
            pinned:  PINNED.includes(sym),
            source:  'binance',
          };
        });

        // ── Extra tokens: Bybit + Kraken in parallel ──
        const extraResults = await Promise.allSettled(
          EXTRA_TOKENS.map(async ({ display, source, bybit, kraken }) => {
            let ticker = null;
            if (source === 'bybit')  ticker = await fetchBybitTicker(bybit);
            if (source === 'kraken') ticker = await fetchKrakenTicker(kraken);
            if (!ticker || !ticker.price) return null;
            return {
              symbol:  display + 'USDT',
              display,
              price:   ticker.price,
              vol:     ticker.vol,
              ch:      ticker.ch,
              pinned:  false,
              source,
            };
          })
        );
        const extraCoins = extraResults
          .filter(r => r.status === 'fulfilled' && r.value)
          .map(r => r.value);

        // Merge — extra coins prepended so always visible
        const allCoins = [...bnCoins];
        extraCoins.forEach(ec => {
          if (!allCoins.find(c => c.symbol === ec.symbol)) allCoins.unshift(ec);
        });

        setCoins(allCoins);
        setLoading(false);
        setFetching(true);

        // Fetch all klines in parallel — Binance + Bybit + Kraken
        const [bnMap, extraKlineResults] = await Promise.all([
          fetchAllKlines(bnSyms, (n) => setProgress(n)),
          Promise.allSettled(
            EXTRA_TOKENS.map(({ display, source, bybit, kraken }) =>
              source === 'bybit'
                ? fetchBybitKlines(bybit, display)
                : fetchKrakenKlines(kraken, display)
            )
          ),
        ]);

        const extraMap = {};
        extraKlineResults.forEach(r => {
          if (r.status === 'fulfilled' && r.value) extraMap[r.value.sym] = r.value;
        });

        setTechMap({ ...bnMap, ...extraMap });
        setFetching(false);
      } catch(e) {
        console.error(e);
      }
    };
    loadAll();
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
    { key:'SIGNALS', label:'SIGNALS', color:'#FF6B00',  count: signalCoins.length },
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
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@700;800;900&family=IBM+Plex+Mono:wght@400;700&family=Barlow+Condensed:wght@700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{background:#0a0a0a;-webkit-font-smoothing:antialiased}
        @keyframes sweep{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
        @keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(245,162,0,0.3)}
        ::selection{background:rgba(245,162,0,0.25);color:#F5A200}
        input::placeholder{color:rgba(255,255,255,0.25)}
        input:focus{outline:none}
        button{cursor:pointer}
      `}</style>

      <div style={{ minHeight:'100vh', background:'#0a0a0a', color:'#fff' }}>

        {/* ── TOPBAR ── */}
        <header style={{
          position:'sticky', top:0, zIndex:300,
          background:'#0a0a0a',
          borderBottom:'2px solid #F5A200',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'0 20px', height:'48px', gap:'12px',
        }}>
          {/* Logo */}
          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
            <div style={{ width:'4px', height:'28px', background:'#F5A200' }} />
            <div>
              <div style={{ fontFamily:COND, fontWeight:900, fontSize:'17px', letterSpacing:'0.08em', color:'#fff', lineHeight:1, textTransform:'uppercase' }}>
                THE MOON<span style={{ color:'#F5A200' }}>_</span>TERMINAL
              </div>
              <div style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', letterSpacing:'0.2em' }}>EMA · RSI · SIGNALS // LIVE</div>
            </div>
          </div>

          {/* Search */}
          <div style={{ flex:'1', maxWidth:'280px', position:'relative', display:'flex', alignItems:'center' }}>
            <span style={{ position:'absolute', left:'10px', fontFamily:MONO, fontSize:'10px', color:'#F5A200', opacity:0.6 }}>{'>'}</span>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='SEARCH COIN_'
              style={{
                width:'100%',
                background:'rgba(245,162,0,0.05)',
                border:'1px solid rgba(245,162,0,0.25)',
                color:'#fff',
                fontFamily:MONO,
                fontSize:'10px',
                letterSpacing:'0.1em',
                padding:'6px 28px 6px 26px',
                textTransform:'uppercase',
                transition:'border-color 0.12s',
              }}
              onFocus={e => e.target.style.borderColor='#F5A200'}
              onBlur={e => e.target.style.borderColor='rgba(245,162,0,0.25)'}
            />
            {search && <button onClick={()=>setSearch('')} style={{ all:'unset', position:'absolute', right:'8px', color:'#F5A200', fontSize:'14px', lineHeight:1 }}>×</button>}
          </div>

          {/* Nav — hamburger on mobile, inline on desktop */}
          <NavMenu page={page} setPage={setPage} />
        </header>

        {/* ── SCANNER PAGE ── */}
        {page === 'SCANNER' && <>

        {/* HERO */}
        <section style={{ padding:'28px 20px 20px', borderBottom:'1px solid rgba(245,162,0,0.2)', background:'#0a0a0a', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', top:0, right:0, bottom:0, width:'35%', background:'linear-gradient(90deg,transparent,rgba(245,162,0,0.02))', pointerEvents:'none' }} />

          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:'20px' }}>
            <div>
              <div style={{ fontFamily:MONO, fontSize:'8px', color:'#F5A200', letterSpacing:'0.4em', marginBottom:'6px', opacity:0.8 }}>// SYSTEM_ACTIVE · LIVE MARKET DATA</div>
              <h1 style={{
                fontFamily:COND, fontWeight:900,
                fontSize:'clamp(64px,12vw,128px)',
                letterSpacing:'-0.01em', lineHeight:0.82,
                color:'#fff', textTransform:'uppercase',
              }}>
                THE<br/>
                <span style={{ color:'#F5A200' }}>MOON</span><br/>
                SCANNER
              </h1>
            </div>

            {/* Stats — bordered boxes like the reference */}
            <div style={{ display:'flex', gap:'0', borderTop:'2px solid #F5A200', borderLeft:'2px solid #F5A200' }}>
              {[
                { label:'BULL', val:bullN, sub:`${bullPct}%`, c:'#CCFF00' },
                { label:'BEAR', val:bearN, sub:`${total>0?Math.round(bearN/total*100):0}%`, c:'#FF2D55' },
                { label:'LIVE', val:total, sub:'assets', c:'#F5A200' },
              ].map(({label,val,sub,c})=>(
                <div key={label} style={{ padding:'12px 16px', borderRight:'2px solid #F5A200', borderBottom:'2px solid #F5A200', minWidth:'80px', background:'#0d0d0d' }}>
                  <div style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', letterSpacing:'0.22em', marginBottom:'4px' }}>{label}</div>
                  <div style={{ fontFamily:COND, fontWeight:900, fontSize:'36px', color:c, lineHeight:1, letterSpacing:'-0.01em' }}>{val}</div>
                  <div style={{ fontFamily:MONO, fontSize:'8px', color:c, fontWeight:700, marginTop:'2px' }}>{sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Sentiment bar */}
          <div style={{ marginTop:'16px', display:'flex', alignItems:'center', gap:'10px' }}>
            <span style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', letterSpacing:'0.2em', flexShrink:0 }}>BULL/BEAR</span>
            <div style={{ flex:1, height:'4px', background:'rgba(255,45,85,0.25)' }}>
              <div style={{ height:'100%', width:`${bullPct}%`, background:'#CCFF00', transition:'width 1s ease' }} />
            </div>
            <span style={{ fontFamily:MONO, fontSize:'7px', color:'#fff', letterSpacing:'0.2em', flexShrink:0 }}>{bullPct}% BULL</span>
          </div>
        </section>

        {/* CONTROLS */}
        <div style={{ position:'sticky', top:'48px', zIndex:200, background:'#0a0a0a', borderBottom:'1px solid rgba(245,162,0,0.2)' }}>
          {/* Filter tabs */}
          <div style={{ padding:'8px 20px', display:'flex', flexWrap:'wrap', gap:'3px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
            {TABS.map(t => <Pill key={t.key} label={t.label} color={t.color} count={t.count} active={zFilter===t.key} onClick={()=>setZFilter(t.key)} />)}
          </div>
          {/* Sort */}
          <div style={{ padding:'6px 20px', display:'flex', alignItems:'center', gap:'4px', flexWrap:'wrap' }}>
            <span style={{ fontFamily:MONO, fontSize:'8px', color:'rgba(245,162,0,0.5)', letterSpacing:'0.2em', marginRight:'6px' }}>SORT_</span>
            {SORTS.map(s => (
              <button key={s.key} onClick={()=>setSortBy(s.key)} style={{
                all:'unset', cursor:'pointer',
                fontFamily:MONO, fontSize:'8px', letterSpacing:'0.08em', textTransform:'uppercase',
                padding:'3px 9px', whiteSpace:'nowrap',
                color: sortBy===s.key ? '#0a0a0a' : 'rgba(255,255,255,0.4)',
                background: sortBy===s.key ? '#F5A200' : 'transparent',
                border:`1px solid ${sortBy===s.key?'#F5A200':'rgba(255,255,255,0.08)'}`,
                transition:'all 0.1s',
              }}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* GRID */}
        <main style={{ padding:'16px 20px 60px', background:'#0a0a0a' }}>
          {loading ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'8px' }}>
              {Array.from({length:24}).map((_,i)=><Skel key={i}/>)}
            </div>
          ) : displayed.length === 0 ? (
            <div style={{ textAlign:'center', padding:'80px 0' }}>
              <div style={{ fontFamily:MONO, fontSize:'11px', letterSpacing:'0.3em', color:'#fff', textTransform:'uppercase' }}>
                [ NO_RESULTS_ ] {search ? `"${search.toUpperCase()}"` : ''}
              </div>
            </div>
          ) : (
            <>
              {search && <div style={{ marginBottom:'12px', fontFamily:MONO, fontSize:'9px', color:'#F5A200', letterSpacing:'0.14em' }}>[ {displayed.length}_RESULTS_ ] FOR "{search.toUpperCase()}"</div>}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'8px' }}>
                {displayed.map(c => (
                  <div key={c.symbol} style={{ animation:'fadein 0.22s ease both' }}>
                    <Card coin={c} tech={techMap[c.symbol]} pinned={c.pinned} onClick={()=>setSelected(c.symbol)} />
                  </div>
                ))}
                {fetching && coins.filter(c=>!techMap[c.symbol]).slice(0,8).map(c=><Skel key={'sk'+c.symbol}/>)}
              </div>
            </>
          )}
        </main>

        {/* FOOTER */}
        <footer style={{ borderTop:'2px solid #F5A200', padding:'10px 20px', display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:'8px', background:'#0a0a0a' }}>
          <span style={{ fontFamily:MONO, fontSize:'8px', color:'#fff', letterSpacing:'0.14em', textTransform:'uppercase' }}>NOT_FINANCIAL_ADVICE_</span>
          <span style={{ fontFamily:MONO, fontSize:'8px', color:'rgba(245,162,0,0.5)', letterSpacing:'0.14em', textTransform:'uppercase' }}>BINANCE · DAILY_CLOSES · SYSTEM_v2.0</span>
        </footer>
        </>}

        {/* LABS */}
        {page === 'LABS' && <LabsPage techMap={techMap} coins={coins} />}

        {/* WAR ROOM */}
        {page === 'WAR' && <WarRoom techMap={techMap} coins={coins} />}

        {/* THE EDGE */}
        {page === 'EDGE' && <TheEdge techMap={techMap} coins={coins} />}

        {/* DERIVATIVES */}
        {page === 'DERIV' && <DerivPage coins={coins} />}

        {/* SENTIMENT */}
        {page === 'SENTIMENT' && <SentimentPage coins={coins} techMap={techMap} />}

        {/* NEWS */}
        {page === 'NEWS' && <NewsPage coins={coins} techMap={techMap} />}

        {/* DETAIL PANEL */}
        {selected && techMap[selected] && (
          <DetailPanel coin={coins.find(c=>c.symbol===selected)} tech={techMap[selected]} onClose={()=>setSelected(null)} />
        )}
      </div>
    </>
  );
}
