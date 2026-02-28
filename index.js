<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AutoDEX Agent — Intercom Autonomous Trading · Trac Network</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@300;400;500;600;700&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
/* ═══════════════════════════════════════════════════
   RESET + VARIABLES
═══════════════════════════════════════════════════ */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg0:#020408;--bg1:#05080f;--bg2:#080d18;--bg3:#0d1525;--bg4:#121c30;--bg5:#172133;
  --line:rgba(0,200,255,0.08);--line2:rgba(0,200,255,0.15);--line3:rgba(0,200,255,0.28);
  --cyan:#00c8ff;--cg:rgba(0,200,255,0.18);--cs:rgba(0,200,255,0.08);
  --grn:#00ff9d;--gg:rgba(0,255,157,0.18);--gs:rgba(0,255,157,0.08);
  --red:#ff2d5e;--rg:rgba(255,45,94,0.18);--rs:rgba(255,45,94,0.08);
  --amb:#ffb300;--ag:rgba(255,179,0,0.18);--as:rgba(255,179,0,0.08);
  --pur:#b44dff;--ps:rgba(180,77,255,0.08);
  --t1:#e8f4ff;--t2:#7a9ab8;--t3:#334455;--t4:#1e2d3d;
  --fd:'Orbitron',sans-serif;--fm:'JetBrains Mono',monospace;--fu:'Rajdhani',sans-serif;
  --r:8px;--rl:14px;
}
html,body{width:100%;height:100%;background:var(--bg0);color:var(--t1);
  font-family:var(--fu);font-size:14px;line-height:1.5;overflow-x:hidden;-webkit-font-smoothing:antialiased}

/* ═══ ATMOSPHERE ═══ */
body::before{content:'';position:fixed;inset:0;
  background-image:linear-gradient(rgba(0,200,255,0.025) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,200,255,0.025) 1px,transparent 1px);
  background-size:40px 40px;pointer-events:none;z-index:0;
  animation:bg-s 80s linear infinite}
@keyframes bg-s{to{background-position:40px 40px}}
body::after{content:'';position:fixed;inset:0;
  background:radial-gradient(ellipse 800px 500px at 15% 0%,rgba(0,200,255,0.05) 0%,transparent 65%),
    radial-gradient(ellipse 600px 400px at 85% 100%,rgba(0,255,157,0.04) 0%,transparent 65%);
  pointer-events:none;z-index:0}

.app{position:relative;z-index:1;display:flex;flex-direction:column;min-height:100vh}

/* ═══ HEADER ═══ */
.hdr{display:flex;align-items:center;justify-content:space-between;height:62px;padding:0 1.5rem;
  background:rgba(5,8,15,0.96);border-bottom:1px solid var(--line2);
  backdrop-filter:blur(24px);position:sticky;top:0;z-index:500;flex-shrink:0}

.logo{display:flex;align-items:center;gap:12px}
.logo-mark{width:38px;height:38px;background:linear-gradient(135deg,var(--cyan),#0060ff);
  border-radius:10px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 20px rgba(0,200,255,0.3),inset 0 1px 0 rgba(255,255,255,0.15);
  flex-shrink:0;animation:lp 4s ease-in-out infinite}
@keyframes lp{0%,100%{box-shadow:0 0 20px rgba(0,200,255,0.3)}50%{box-shadow:0 0 35px rgba(0,200,255,0.55)}}
.logo-mark svg{width:20px;height:20px;fill:white}
.logo-name{font-family:var(--fd);font-size:.95rem;font-weight:700;letter-spacing:.12em;
  background:linear-gradient(90deg,var(--cyan),#60b0ff);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.logo-sub{font-family:var(--fm);font-size:.52rem;color:var(--t3);letter-spacing:.18em;text-transform:uppercase}

.hdr-ticks{display:flex;gap:2rem}
.hdt{display:flex;flex-direction:column;align-items:center;gap:2px}
.hdt-lbl{font-family:var(--fm);font-size:.52rem;color:var(--t3);text-transform:uppercase;letter-spacing:.12em}
.hdt-val{font-family:var(--fm);font-size:.8rem;font-weight:600;color:var(--t1)}
.hdt-sub{font-family:var(--fm);font-size:.52rem;letter-spacing:.05em}
.up{color:var(--grn)}.down{color:var(--red)}

.hdr-right{display:flex;align-items:center;gap:.75rem}
.live-badge{display:flex;align-items:center;gap:6px;background:var(--gs);
  border:1px solid rgba(0,255,157,0.25);border-radius:20px;padding:.3rem .8rem;
  font-family:var(--fm);font-size:.6rem;color:var(--grn);letter-spacing:.1em;text-transform:uppercase}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--grn);animation:dp 2s ease-in-out infinite}
@keyframes dp{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(0,255,157,0.6)}50%{opacity:.8;box-shadow:0 0 0 5px rgba(0,255,157,0)}}
.peers-badge{font-family:var(--fm);font-size:.6rem;color:var(--t2);
  border:1px solid var(--line2);border-radius:20px;padding:.3rem .8rem;letter-spacing:.05em}

/* ═══ TICKER BAR ═══ */
.ticker-bar{height:32px;background:rgba(0,200,255,0.04);border-bottom:1px solid var(--line);
  display:flex;align-items:center;overflow:hidden;flex-shrink:0}
.ticker-lbl{flex-shrink:0;padding:0 1rem;font-family:var(--fm);font-size:.58rem;color:var(--cyan);
  letter-spacing:.12em;text-transform:uppercase;border-right:1px solid var(--line2);
  background:rgba(0,200,255,0.06);height:100%;display:flex;align-items:center}
.ticker-scroll{flex:1;overflow:hidden}
.ticker-inner{display:inline-flex;gap:3rem;white-space:nowrap;
  animation:tmove 50s linear infinite;font-family:var(--fm);font-size:.6rem;color:var(--t2);padding:0 1rem}
@keyframes tmove{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
.ti{display:inline-flex;align-items:center;gap:.4rem}
.ti-k{color:var(--cyan)}.ti-v{color:var(--t1);font-weight:500}.ti-c{color:var(--grn)}

/* ═══ LAYOUT ═══ */
.layout{display:grid;grid-template-columns:310px 1fr 300px;flex:1;overflow:hidden;height:calc(100vh - 94px)}
.col{overflow-y:auto;overflow-x:hidden;border-right:1px solid var(--line)}
.col:last-child{border-right:none}
.col::-webkit-scrollbar{width:3px}
.col::-webkit-scrollbar-thumb{background:var(--line2);border-radius:2px}

/* ═══ PANELS ═══ */
.pnl{padding:1rem 1.1rem;border-bottom:1px solid var(--line)}
.pnl-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem}
.pnl-title{font-family:var(--fm);font-size:.58rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.18em;color:var(--t3);display:flex;align-items:center;gap:.5rem}
.pnl-title::before{content:'';width:3px;height:11px;border-radius:2px;display:inline-block}
.pt-c::before{background:var(--cyan);box-shadow:0 0 8px var(--cyan)}
.pt-g::before{background:var(--grn);box-shadow:0 0 8px var(--grn)}
.pt-a::before{background:var(--amb);box-shadow:0 0 8px var(--amb)}
.pt-r::before{background:var(--red);box-shadow:0 0 8px var(--red)}
.pt-p::before{background:var(--pur);box-shadow:0 0 8px var(--pur)}
.pnl-cnt{font-family:var(--fm);font-size:.58rem;color:var(--t3)}

/* ═══ AGENT CARDS ═══ */
.acard{background:var(--bg3);border:1px solid var(--line);border-radius:var(--rl);
  padding:1rem;margin-bottom:.65rem;position:relative;overflow:hidden;
  transition:border-color .2s,box-shadow .2s}
.acard::before{content:'';position:absolute;inset:0;
  background:linear-gradient(130deg,rgba(0,200,255,0.04) 0%,transparent 55%);
  pointer-events:none;border-radius:var(--rl)}
.acard:hover{border-color:var(--line3);box-shadow:0 0 24px rgba(0,200,255,0.07)}
.acard.run{border-left:3px solid var(--grn)}
.acard.paused{border-left:3px solid var(--amb)}
.acard.idle{border-left:3px solid var(--t3)}

.ac-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem}
.ac-nm{display:flex;align-items:center;gap:.5rem}
.ac-icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;
  justify-content:center;font-size:.85rem;flex-shrink:0}
.ic-buy {background:var(--gs);border:1px solid rgba(0,255,157,0.2)}
.ic-sell{background:var(--rs);border:1px solid rgba(255,45,94,0.2)}
.ic-arb {background:var(--as);border:1px solid rgba(255,179,0,0.2)}
.ic-wtch{background:var(--cs);border:1px solid rgba(0,200,255,0.2)}
.ac-name{font-family:var(--fm);font-size:.72rem;font-weight:600;color:var(--t1)}

.sbadge{font-family:var(--fm);font-size:.55rem;font-weight:700;letter-spacing:.1em;
  text-transform:uppercase;padding:.18rem .5rem;border-radius:4px}
.sb-run{background:var(--gs);color:var(--grn);border:1px solid rgba(0,255,157,0.25)}
.sb-pau{background:var(--as);color:var(--amb);border:1px solid rgba(255,179,0,0.25)}
.sb-idl{background:var(--bg4);color:var(--t3);border:1px solid var(--line)}

.ac-trig{background:var(--bg1);border:1px solid var(--line);border-radius:var(--r);
  padding:.6rem .7rem;font-family:var(--fm);font-size:.62rem;line-height:1.8;margin-bottom:.7rem}
.tk-if{color:var(--cyan);font-weight:600}
.tk-and{color:var(--pur);font-weight:600}
.tk-then{color:var(--grn);font-weight:600}
.tk-val{color:var(--amb);font-weight:600}
.tk-op{color:var(--t2)}

.ac-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;margin-bottom:.65rem}
.acst{background:var(--bg1);border:1px solid var(--line);border-radius:var(--r);
  padding:.4rem .5rem;text-align:center}
.acst-v{font-family:var(--fm);font-size:.75rem;font-weight:600;display:block;line-height:1;margin-bottom:.15rem}
.acst-l{font-family:var(--fm);font-size:.5rem;color:var(--t3);text-transform:uppercase;letter-spacing:.1em}

.ac-prog{height:2px;background:var(--bg1);border-radius:2px;overflow:hidden;margin-bottom:.65rem}
.ac-prog-fill{height:100%;border-radius:2px;transition:width .8s ease}

.ac-ctrls{display:flex;gap:.35rem}
.bctrl{flex:1;background:var(--bg1);border:1px solid var(--line);border-radius:6px;
  color:var(--t2);font-family:var(--fm);font-size:.58rem;font-weight:500;
  letter-spacing:.08em;text-transform:uppercase;padding:.35rem .3rem;cursor:pointer;
  transition:all .15s;display:flex;align-items:center;justify-content:center;gap:3px}
.bctrl:hover{background:var(--bg4);color:var(--t1);border-color:var(--line2)}
.bctrl.pause:hover{border-color:var(--amb);color:var(--amb);background:var(--as)}
.bctrl.resume:hover{border-color:var(--grn);color:var(--grn);background:var(--gs)}
.bctrl.edit:hover{border-color:var(--cyan);color:var(--cyan);background:var(--cs)}
.bctrl.force:hover{border-color:var(--pur);color:var(--pur);background:var(--ps)}

/* ═══ BUILDER ═══ */
.builder{background:var(--bg1);border:1px dashed var(--line2);border-radius:var(--rl);padding:1rem}
.builder-title{font-family:var(--fm);font-size:.68rem;font-weight:600;color:var(--cyan);
  margin-bottom:.85rem;display:flex;align-items:center;gap:.5rem;letter-spacing:.05em}
.field{margin-bottom:.55rem}
.flbl{font-family:var(--fm);font-size:.55rem;color:var(--t3);text-transform:uppercase;
  letter-spacing:.12em;margin-bottom:.28rem}
.finput,.fselect{width:100%;background:var(--bg0);border:1px solid var(--line);border-radius:6px;
  color:var(--t1);font-family:var(--fm);font-size:.68rem;padding:.45rem .65rem;
  outline:none;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}
.finput:focus,.fselect:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(0,200,255,0.08)}
.f2{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.btn-deploy{width:100%;background:linear-gradient(135deg,#00aaff,#0044ff);border:none;
  border-radius:8px;color:#fff;font-family:var(--fm);font-size:.68rem;font-weight:700;
  letter-spacing:.12em;text-transform:uppercase;padding:.7rem;cursor:pointer;margin-top:.75rem;
  position:relative;overflow:hidden;transition:transform .15s,opacity .15s;
  box-shadow:0 4px 20px rgba(0,100,255,0.3)}
.btn-deploy::after{content:'';position:absolute;inset:0;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);
  transform:translateX(-100%);transition:transform .45s}
.btn-deploy:hover{opacity:.92;transform:translateY(-1px)}.btn-deploy:hover::after{transform:translateX(100%)}
.btn-deploy:active{transform:translateY(0)}

/* ═══ CHANNELS ═══ */
.ch-item{display:flex;align-items:center;gap:.6rem;padding:.45rem .55rem;border-radius:7px;
  cursor:pointer;font-family:var(--fm);font-size:.63rem;color:var(--t2);
  transition:background .15s;margin-bottom:.12rem}
.ch-item:hover{background:var(--bg4)}
.ch-item.active{background:var(--cs);border:1px solid rgba(0,200,255,0.15);color:var(--t1)}
.chdot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.chdot.live{background:var(--grn);animation:dp 2s infinite}
.chdot.act{background:var(--cyan);animation:dp 2s infinite}
.chdot.idle{background:var(--t4)}
.ch-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-cnt{font-size:.55rem;color:var(--t3);background:var(--bg1);border:1px solid var(--line);
  border-radius:10px;padding:.08rem .4rem}

/* ═══ CENTER COL ═══ */
.center-col{display:flex;flex-direction:column;overflow:hidden}

/* Chart */
.chart-area{padding:1.25rem 1.5rem 1rem;border-bottom:1px solid var(--line);flex-shrink:0}
.chart-top{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:.85rem}
.chart-price{font-family:var(--fd);font-size:2.5rem;font-weight:700;color:var(--t1);
  letter-spacing:.04em;line-height:1}
.chart-chg{font-family:var(--fm);font-size:.78rem;font-weight:600;margin-left:.6rem}
.chart-meta{text-align:right;font-family:var(--fm);font-size:.62rem;color:var(--t2);line-height:1.8}
.cm-lbl{color:var(--t3);text-transform:uppercase;font-size:.55rem;letter-spacing:.1em}

.tf-row{display:flex;gap:.25rem;margin-bottom:.85rem}
.tf{background:none;border:1px solid var(--line);border-radius:5px;color:var(--t3);
  font-family:var(--fm);font-size:.58rem;padding:.22rem .55rem;cursor:pointer;
  letter-spacing:.06em;transition:all .15s}
.tf:hover{color:var(--t2);border-color:var(--line2)}
.tf.active{background:var(--cs);border-color:var(--cyan);color:var(--cyan)}

.chart-wrap{position:relative;width:100%;height:210px}
.chart-svg{width:100%;height:100%;overflow:visible}

/* Stats strip */
.stats-strip{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line);flex-shrink:0}
.stat-cell{padding:.7rem 1.2rem;border-right:1px solid var(--line)}
.stat-cell:last-child{border-right:none}
.stat-lbl{font-family:var(--fm);font-size:.52rem;color:var(--t3);text-transform:uppercase;
  letter-spacing:.12em;margin-bottom:.3rem}
.stat-val{font-family:var(--fd);font-size:1.25rem;font-weight:700;line-height:1;letter-spacing:.05em}

/* Event Log */
.evlog{flex:1;overflow-y:auto;padding:1rem 1.4rem}
.evlog::-webkit-scrollbar{width:3px}
.evlog::-webkit-scrollbar-thumb{background:var(--line2)}
.evlog-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:.85rem;
  position:sticky;top:0;background:var(--bg0);padding-bottom:.5rem;border-bottom:1px solid var(--line)}
.evitem{display:flex;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--line);animation:ev-in .3s ease}
@keyframes ev-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
.ev-time{font-family:var(--fm);font-size:.56rem;color:var(--t3);min-width:52px;padding-top:3px}
.ev-track{display:flex;flex-direction:column;align-items:center;padding-top:4px}
.ev-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.ev-line{width:1px;flex:1;min-height:18px;background:var(--line)}
.ev-body{flex:1;min-width:0}
.ev-title{font-family:var(--fm);font-size:.7rem;font-weight:600;color:var(--t1);
  margin-bottom:.2rem;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.ev-detail{font-family:var(--fm);font-size:.6rem;color:var(--t2);line-height:1.6}
.echip{display:inline-flex;align-items:center;font-size:.52rem;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;padding:.1rem .38rem;border-radius:3px}
.ch-exec{background:var(--gs);color:var(--grn);border:1px solid rgba(0,255,157,0.2)}
.ch-trig{background:var(--cs);color:var(--cyan);border:1px solid rgba(0,200,255,0.2)}
.ch-alrt{background:var(--as);color:var(--amb);border:1px solid rgba(255,179,0,0.2)}
.ch-rfq {background:var(--as);color:var(--amb);border:1px solid rgba(255,179,0,0.2)}
.ch-wtch{background:var(--cs);color:var(--cyan);border:1px solid rgba(0,200,255,0.2)}

/* ═══ RIGHT COL ═══ */
.cond-row{display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--line);
  font-family:var(--fm);font-size:.63rem}
.cind{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.ci-met{background:var(--grn);box-shadow:0 0 8px var(--grn)}
.ci-unmet{background:var(--t4)}
.ci-warn{background:var(--amb);box-shadow:0 0 8px var(--amb);animation:dp 1.5s infinite}
.clbl{flex:1;color:var(--t2)}.cval{font-weight:600;white-space:nowrap}

.depth-row{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:center;
  padding:.26rem 0;position:relative;cursor:pointer;font-family:var(--fm);font-size:.62rem;
  border-radius:3px;transition:background .1s}
.depth-row:hover{background:var(--bg4)}
.dbar{position:absolute;top:0;bottom:0;opacity:.1;border-radius:3px;transition:opacity .2s}
.depth-row:hover .dbar{opacity:.18}
.dbar-a{right:0;background:var(--red)}.dbar-b{left:0;background:var(--grn)}
.dp{text-align:center;font-weight:600;padding:0 .3rem}
.dp.ask{color:var(--red)}.dp.bid{color:var(--grn)}
.dq{color:var(--t3);font-size:.58rem}.dq.r{text-align:right}
.dspr{text-align:center;padding:.4rem;font-family:var(--fm);font-size:.6rem;color:var(--t3);
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin:.2rem 0}

.wr{display:flex;align-items:center;justify-content:space-between;
  padding:.65rem 0;border-bottom:1px solid var(--line)}
.wl{display:flex;align-items:center;gap:.6rem}
.wicon{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:var(--fm);font-size:.75rem;font-weight:700;flex-shrink:0}
.wi-b{background:rgba(247,147,26,0.12);color:#f7931a;border:1px solid rgba(247,147,26,0.25)}
.wi-u{background:var(--gs);color:var(--grn);border:1px solid rgba(0,255,157,0.2)}
.wi-s{background:var(--ps);color:var(--pur);border:1px solid rgba(180,77,255,0.2)}
.wi-t{background:var(--cs);color:var(--cyan);border:1px solid rgba(0,200,255,0.2)}
.wname{font-family:var(--fm);font-size:.7rem;font-weight:600}
.wnet{font-family:var(--fm);font-size:.55rem;color:var(--t3)}
.wright{text-align:right}
.wamt{font-family:var(--fm);font-size:.75rem;font-weight:600;display:block}
.wusd{font-family:var(--fm);font-size:.56rem;color:var(--t3)}

.pbars{display:flex;align-items:flex-end;gap:3px;height:40px}
.pbar{flex:1;border-radius:2px;cursor:pointer;transition:filter .15s;min-height:4px}
.pbar.pos{background:rgba(0,255,157,0.35)}.pbar.neg{background:rgba(255,45,94,0.35)}
.pbar:hover{filter:brightness(1.6)}
.pdays{display:flex;justify-content:space-between;font-family:var(--fm);
  font-size:.52rem;color:var(--t3);margin-top:.25rem}
.mstats{display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-top:.75rem}
.msbox{background:var(--bg1);border:1px solid var(--line);border-radius:var(--r);padding:.6rem .7rem}
.msv{font-family:var(--fd);font-size:1.2rem;font-weight:700;display:block;line-height:1;
  margin-bottom:.2rem;letter-spacing:.03em}
.msl{font-family:var(--fm);font-size:.5rem;color:var(--t3);text-transform:uppercase;letter-spacing:.12em}

/* ═══ MODAL ═══ */
.modal-bg{position:fixed;inset:0;background:rgba(2,4,8,0.88);backdrop-filter:blur(10px);
  z-index:1000;display:flex;align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s}
.modal-bg.open{opacity:1;pointer-events:auto}
.modal{background:var(--bg3);border:1px solid var(--line3);border-radius:var(--rl);
  padding:1.5rem;width:460px;max-width:90vw;transform:scale(.96);transition:transform .2s;
  box-shadow:0 0 60px rgba(0,200,255,0.12)}
.modal-bg.open .modal{transform:scale(1)}
.modal-title{font-family:var(--fd);font-size:1.1rem;letter-spacing:.1em;color:var(--cyan);
  margin-bottom:1.25rem;display:flex;align-items:center;gap:.6rem}
.mrow{display:flex;align-items:center;justify-content:space-between;
  padding:.5rem 0;border-bottom:1px solid var(--line);font-family:var(--fm);font-size:.66rem}
.mkey{color:var(--t3)}.mval{color:var(--t1);font-weight:600}
.mval.grn{color:var(--grn)}.mval.cy{color:var(--cyan)}
.macts{display:flex;gap:.75rem;margin-top:1.2rem}
.bmod{flex:1;background:none;border:1px solid var(--line);border-radius:8px;color:var(--t2);
  font-family:var(--fm);font-size:.66rem;font-weight:600;letter-spacing:.08em;
  text-transform:uppercase;padding:.65rem;cursor:pointer;transition:all .15s}
.bmod:hover{border-color:var(--line2);color:var(--t1)}
.bmod.ok{background:linear-gradient(135deg,var(--grn),#00cc77);border-color:var(--grn);
  color:#001a0d;font-weight:700;box-shadow:0 4px 20px rgba(0,255,157,0.2)}
.bmod.ok:hover{opacity:.9}

/* ═══ TOASTS ═══ */
#toasts{position:fixed;bottom:1.5rem;right:1.5rem;z-index:2000;
  display:flex;flex-direction:column;gap:.5rem;pointer-events:none}
.toast{background:var(--bg4);border:1px solid var(--line2);border-radius:var(--r);
  padding:.75rem 1rem;font-family:var(--fm);font-size:.65rem;
  display:flex;align-items:flex-start;gap:.6rem;max-width:300px;
  box-shadow:0 8px 32px rgba(0,0,0,0.6);animation:tin .3s ease;pointer-events:auto}
@keyframes tin{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@keyframes tout{to{opacity:0;transform:translateX(16px)}}
.toast.fading{animation:tout .3s ease forwards}
.toast-ico{font-size:.9rem;flex-shrink:0;margin-top:1px}
.toast-t{color:var(--t1);font-weight:600;margin-bottom:2px}
.toast-d{color:var(--t2);font-size:.58rem}
.toast.exec{border-left:3px solid var(--grn)}
.toast.alert{border-left:3px solid var(--amb)}
.toast.error{border-left:3px solid var(--red)}
.toast.info{border-left:3px solid var(--cyan)}

/* ═══ RESPONSIVE ═══ */
@media(max-width:1100px){.layout{grid-template-columns:300px 1fr}.col:last-child{display:none}.hdr-ticks{gap:1.2rem}}
@media(max-width:720px){.layout{grid-template-columns:1fr}.col:not(:first-child){display:none}.hdr-ticks{display:none}}
</style>
</head>
<body>
<div class="app">

<!-- HEADER -->
<header class="hdr">
  <div class="logo">
    <div class="logo-mark">
      <svg viewBox="0 0 24 24"><path d="M13 3L4 14h8l-1 7 9-11h-8l1-7z"/></svg>
    </div>
    <div>
      <div class="logo-name">AUTODEX AGENT</div>
      <div class="logo-sub">Intercom · Trac Network · Event-Driven DEX</div>
    </div>
  </div>

  <div class="hdr-ticks">
    <div class="hdt">
      <span class="hdt-lbl">BTC / USDT</span>
      <span class="hdt-val" id="h-price">$96,420</span>
      <span class="hdt-sub up" id="h-chg">▲ 1.24%</span>
    </div>
    <div class="hdt">
      <span class="hdt-lbl">SOL Slot</span>
      <span class="hdt-val" id="h-slot">325,841,182</span>
      <span class="hdt-sub up">▲ LIVE</span>
    </div>
    <div class="hdt">
      <span class="hdt-lbl">Agents</span>
      <span class="hdt-val" id="h-agents">4 Active</span>
      <span class="hdt-sub up">▲ Running</span>
    </div>
    <div class="hdt">
      <span class="hdt-lbl">P&amp;L Today</span>
      <span class="hdt-val up" id="h-pnl">+$1,285</span>
      <span class="hdt-sub up" id="h-execs">▲ 22 trades</span>
    </div>
  </div>

  <div class="hdr-right">
    <div class="peers-badge" id="h-peers">⬡ 14 Peers</div>
    <div class="live-badge"><div class="live-dot"></div>P2P LIVE</div>
  </div>
</header>

<!-- TICKER -->
<div class="ticker-bar">
  <div class="ticker-lbl">📡 Events</div>
  <div class="ticker-scroll">
    <div class="ticker-inner" id="ticker-inner"></div>
  </div>
</div>

<!-- LAYOUT -->
<div class="layout">

  <!-- ═══ LEFT COL ═══ -->
  <div class="col">

    <div class="pnl">
      <div class="pnl-hdr">
        <span class="pnl-title pt-c">Active Agents</span>
        <span class="pnl-cnt">3 running · 1 paused</span>
      </div>

      <!-- Agent 1: AutoBuy -->
      <div class="acard run" id="card-a1">
        <div class="ac-hdr">
          <div class="ac-nm">
            <div class="ac-icon ic-buy">⬆</div>
            <span class="ac-name">AutoBuy · BTC / USDT</span>
          </div>
          <span class="sbadge sb-run" id="badge-a1">RUNNING</span>
        </div>
        <div class="ac-trig">
          <div><span class="tk-if">IF</span><span class="tk-op"> price </span><span class="tk-val">&lt; $96,200</span></div>
          <div><span class="tk-and">AND</span><span class="tk-op"> rsi_14 </span><span class="tk-val">&lt; 40</span></div>
          <div><span class="tk-then">THEN</span><span class="tk-op"> swap </span><span class="tk-val">50,000 sats</span><span class="tk-op"> via LN → SOL</span></div>
        </div>
        <div class="ac-stats">
          <div class="acst"><span class="acst-v up" id="a1-execs">12</span><span class="acst-l">Executions</span></div>
          <div class="acst"><span class="acst-v up">+$842</span><span class="acst-l">P&amp;L</span></div>
          <div class="acst"><span class="acst-v" style="color:var(--cyan)">$96,200</span><span class="acst-l">Trigger</span></div>
        </div>
        <div class="ac-prog"><div class="ac-prog-fill" style="width:74%;background:linear-gradient(90deg,var(--cyan),var(--grn))"></div></div>
        <div class="ac-ctrls">
          <button class="bctrl pause" onclick="toggleAgent('a1','pause')">⏸ Pause</button>
          <button class="bctrl edit"  onclick="openModal('AutoBuy','50,000 sats','BTC → USDT','price &lt; $96,200')">✎ Edit</button>
          <button class="bctrl force" onclick="forceRun('AutoBuy')">▶ Force</button>
        </div>
      </div>

      <!-- Agent 2: AutoSell -->
      <div class="acard run" id="card-a2">
        <div class="ac-hdr">
          <div class="ac-nm">
            <div class="ac-icon ic-sell">⬇</div>
            <span class="ac-name">AutoSell · BTC / USDT</span>
          </div>
          <span class="sbadge sb-run" id="badge-a2">RUNNING</span>
        </div>
        <div class="ac-trig">
          <div><span class="tk-if">IF</span><span class="tk-op"> price </span><span class="tk-val">&gt; $97,500</span></div>
          <div><span class="tk-and">AND</span><span class="tk-op"> volume_1h </span><span class="tk-val">&gt; 2.0 BTC</span></div>
          <div><span class="tk-then">THEN</span><span class="tk-op"> swap </span><span class="tk-val">30,000 sats</span><span class="tk-op"> via LN → SOL</span></div>
        </div>
        <div class="ac-stats">
          <div class="acst"><span class="acst-v up" id="a2-execs">7</span><span class="acst-l">Executions</span></div>
          <div class="acst"><span class="acst-v up">+$316</span><span class="acst-l">P&amp;L</span></div>
          <div class="acst"><span class="acst-v" style="color:var(--cyan)">$97,500</span><span class="acst-l">Trigger</span></div>
        </div>
        <div class="ac-prog"><div class="ac-prog-fill" style="width:31%;background:linear-gradient(90deg,var(--amb),var(--red))"></div></div>
        <div class="ac-ctrls">
          <button class="bctrl pause"  onclick="toggleAgent('a2','pause')">⏸ Pause</button>
          <button class="bctrl edit"   onclick="openModal('AutoSell','30,000 sats','BTC → USDT','price &gt; $97,500')">✎ Edit</button>
          <button class="bctrl force"  onclick="forceRun('AutoSell')">▶ Force</button>
        </div>
      </div>

      <!-- Agent 3: Arb -->
      <div class="acard paused" id="card-a3">
        <div class="ac-hdr">
          <div class="ac-nm">
            <div class="ac-icon ic-arb">⇄</div>
            <span class="ac-name">Arb Monitor · Spread</span>
          </div>
          <span class="sbadge sb-pau" id="badge-a3">PAUSED</span>
        </div>
        <div class="ac-trig">
          <div><span class="tk-if">IF</span><span class="tk-op"> spread </span><span class="tk-val">&gt; 0.05%</span></div>
          <div><span class="tk-and">AND</span><span class="tk-op"> ln_liquidity </span><span class="tk-val">&gt; 100k sats</span></div>
          <div><span class="tk-then">THEN</span><span class="tk-op"> execute </span><span class="tk-val">arb swap both legs</span></div>
        </div>
        <div class="ac-stats">
          <div class="acst"><span class="acst-v up">3</span><span class="acst-l">Executions</span></div>
          <div class="acst"><span class="acst-v up">+$127</span><span class="acst-l">P&amp;L</span></div>
          <div class="acst"><span class="acst-v" style="color:var(--t3)">0.019%</span><span class="acst-l">Spread</span></div>
        </div>
        <div class="ac-prog"><div class="ac-prog-fill" style="width:38%;background:var(--amb)"></div></div>
        <div class="ac-ctrls">
          <button class="bctrl resume" onclick="toggleAgent('a3','resume')">▶ Resume</button>
          <button class="bctrl edit"   onclick="openModal('ArbMonitor','arb swap','BTC ⇄ USDT','spread &gt; 0.05%')">✎ Edit</button>
          <button class="bctrl">📊 Log</button>
        </div>
      </div>

      <!-- Agent 4: Chain Watcher -->
      <div class="acard run" id="card-a4">
        <div class="ac-hdr">
          <div class="ac-nm">
            <div class="ac-icon ic-wtch">◉</div>
            <span class="ac-name">Chain Watcher · Solana</span>
          </div>
          <span class="sbadge sb-run" id="badge-a4">RUNNING</span>
        </div>
        <div class="ac-trig">
          <div><span class="tk-if">IF</span><span class="tk-op"> escrow_slot </span><span class="tk-val">confirmed</span></div>
          <div><span class="tk-and">AND</span><span class="tk-op"> preimage </span><span class="tk-val">present</span></div>
          <div><span class="tk-then">THEN</span><span class="tk-op"> auto_claim </span><span class="tk-val">USDT escrow</span></div>
        </div>
        <div class="ac-stats">
          <div class="acst"><span class="acst-v up">28</span><span class="acst-l">Watched</span></div>
          <div class="acst"><span class="acst-v up">100%</span><span class="acst-l">Claimed</span></div>
          <div class="acst"><span class="acst-v" style="color:var(--cyan)" id="a4-slot">325.8M</span><span class="acst-l">SOL Slot</span></div>
        </div>
        <div class="ac-prog"><div class="ac-prog-fill" style="width:88%;background:linear-gradient(90deg,var(--pur),var(--cyan))"></div></div>
        <div class="ac-ctrls">
          <button class="bctrl pause"  onclick="toggleAgent('a4','pause')">⏹ Stop</button>
          <button class="bctrl edit"   onclick="openModal('ChainWatcher','USDT claim','SOL Escrow','escrow confirmed')">✎ Edit</button>
          <button class="bctrl resume">↻ Restart</button>
        </div>
      </div>
    </div><!-- /agents panel -->

    <!-- Builder -->
    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-c">Build New Agent</span></div>
      <div class="builder">
        <div class="builder-title">⚙ Define Trigger Conditions</div>
        <div class="field">
          <div class="flbl">Agent Type</div>
          <select class="fselect" id="b-type">
            <option>AutoBuy — Buy when price drops</option>
            <option>AutoSell — Sell when price rises</option>
            <option>Arb Monitor — Spread arbitrage</option>
            <option>Chain Watcher — On-chain events</option>
            <option>Custom — Define your own logic</option>
          </select>
        </div>
        <div class="f2">
          <div class="field"><div class="flbl">Token In</div>
            <select class="fselect" id="b-in">
              <option>BTC (Lightning)</option><option>USDT (Solana)</option><option>SOL</option><option>TNK</option>
            </select></div>
          <div class="field"><div class="flbl">Token Out</div>
            <select class="fselect" id="b-out">
              <option>USDT (Solana)</option><option>BTC (Lightning)</option><option>SOL</option><option>TNK</option>
            </select></div>
        </div>
        <div class="f2">
          <div class="field"><div class="flbl">Condition</div>
            <select class="fselect">
              <option>price &lt; threshold</option><option>price &gt; threshold</option>
              <option>spread &gt; %</option><option>rsi &lt; value</option>
              <option>volume &gt; value</option><option>block confirmed</option>
            </select></div>
          <div class="field"><div class="flbl">Value</div>
            <input class="finput" id="b-thresh" type="text" placeholder="96200 or 0.05%"></div>
        </div>
        <div class="f2">
          <div class="field"><div class="flbl">Amount (sats)</div>
            <input class="finput" id="b-amount" type="text" placeholder="50000"></div>
          <div class="field"><div class="flbl">Max Fee %</div>
            <input class="finput" type="text" value="0.2" placeholder="0.2"></div>
        </div>
        <div class="field">
          <div class="flbl">Sidechannel</div>
          <input class="finput" type="text" value="0000intercomswapbtcusdt">
        </div>
        <button class="btn-deploy" onclick="deployAgent()">⚡ Deploy Agent</button>
      </div>
    </div>

    <!-- Channels -->
    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-c">P2P Sidechannels</span></div>
      <div class="ch-item active"><div class="chdot act"></div><span class="ch-name">0000intercomswapbtcusdt</span><span class="ch-cnt">14</span></div>
      <div class="ch-item"><div class="chdot live"></div><span class="ch-name">0000intercom</span><span class="ch-cnt">31</span></div>
      <div class="ch-item"><div class="chdot idle"></div><span class="ch-name">swap:trade_9f3c…</span><span class="ch-cnt">2</span></div>
      <div class="ch-item"><div class="chdot idle"></div><span class="ch-name">swap:trade_a12d…</span><span class="ch-cnt">2</span></div>
      <div class="ch-item"><div class="chdot idle"></div><span class="ch-name">swap:trade_b78e…</span><span class="ch-cnt">2</span></div>
    </div>

  </div><!-- /left col -->


  <!-- ═══ CENTER COL ═══ -->
  <div class="center-col">

    <div class="chart-area">
      <div class="chart-top">
        <div>
          <span class="chart-price" id="c-price">$96,420</span>
          <span class="chart-chg up" id="c-chg">+$1,182 (1.24%)</span>
        </div>
        <div class="chart-meta">
          <div><span class="cm-lbl">24H High </span><span id="c-high">$97,104</span></div>
          <div><span class="cm-lbl">24H Low &nbsp;</span><span id="c-low">$94,828</span></div>
          <div><span class="cm-lbl">Volume &nbsp;&nbsp;</span><span>$2.41M</span></div>
        </div>
      </div>

      <div class="tf-row">
        <button class="tf">1H</button>
        <button class="tf active">1D</button>
        <button class="tf">1W</button>
        <button class="tf">1M</button>
      </div>

      <div class="chart-wrap">
        <svg class="chart-svg" id="main-svg" viewBox="0 0 900 210" preserveAspectRatio="none">
          <defs>
            <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stop-color="#00c8ff" stop-opacity="0.22"/>
              <stop offset="100%" stop-color="#00c8ff" stop-opacity="0"/>
            </linearGradient>
            <filter id="gf">
              <feGaussianBlur stdDeviation="2.5" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <line x1="0" y1="52"  x2="900" y2="52"  stroke="rgba(0,200,255,0.04)" stroke-width="1"/>
          <line x1="0" y1="105" x2="900" y2="105" stroke="rgba(0,200,255,0.04)" stroke-width="1"/>
          <line x1="0" y1="158" x2="900" y2="158" stroke="rgba(0,200,255,0.04)" stroke-width="1"/>
          <line id="l-sell" x1="0" y1="35"  x2="900" y2="35"  stroke="#ff2d5e" stroke-dasharray="5 4" stroke-width="1" opacity="0.6"/>
          <text id="t-sell" x="5" y="30"  fill="#ff2d5e" font-family="JetBrains Mono,monospace" font-size="9" opacity="0.85">SELL $97,500</text>
          <line id="l-buy"  x1="0" y1="178" x2="900" y2="178" stroke="#00ff9d" stroke-dasharray="5 4" stroke-width="1" opacity="0.6"/>
          <text id="t-buy"  x="5" y="192" fill="#00ff9d" font-family="JetBrains Mono,monospace" font-size="9" opacity="0.85">BUY $96,200</text>
          <path id="c-area" fill="url(#aGrad)"/>
          <path id="c-line" fill="none" stroke="#00c8ff" stroke-width="2" filter="url(#gf)"/>
          <g id="c-marks"></g>
          <line id="cx"  x1="0" y1="0" x2="0" y2="210" stroke="rgba(0,200,255,0.25)" stroke-width="1" visibility="hidden"/>
          <circle id="cd" cx="0" cy="0" r="4" fill="#00c8ff" stroke="#020408" stroke-width="2" visibility="hidden"/>
        </svg>
      </div>
    </div>

    <div class="stats-strip">
      <div class="stat-cell"><div class="stat-lbl">Total P&amp;L</div><div class="stat-val up" id="s-pnl">+$1,285</div></div>
      <div class="stat-cell"><div class="stat-lbl">Executions</div><div class="stat-val" style="color:var(--cyan)" id="s-execs">22</div></div>
      <div class="stat-cell"><div class="stat-lbl">Success Rate</div><div class="stat-val up">97.3%</div></div>
      <div class="stat-cell"><div class="stat-lbl">Avg Latency</div><div class="stat-val" style="color:var(--amb)">28s</div></div>
    </div>

    <div class="evlog" id="evlog">
      <div class="evlog-hdr">
        <span class="pnl-title pt-g" style="margin-bottom:0">Agent Event Log</span>
        <span style="font-family:var(--fm);font-size:.58rem;color:var(--t3);cursor:pointer"
              onclick="document.querySelectorAll('#evlog .evitem').forEach(function(e){e.remove()})">CLEAR</span>
      </div>
    </div>

  </div><!-- /center col -->


  <!-- ═══ RIGHT COL ═══ -->
  <div class="col">

    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-a">Condition Monitor</span></div>
      <div class="cond-row"><div class="cind ci-unmet" id="ci-1"></div><div class="clbl">BTC &lt; $96,200 (AutoBuy)</div><div class="cval down" id="cv-1">$96,420 ✗</div></div>
      <div class="cond-row"><div class="cind ci-unmet" id="ci-2"></div><div class="clbl">BTC &gt; $97,500 (AutoSell)</div><div class="cval" style="color:var(--t3)" id="cv-2">$96,420 ✗</div></div>
      <div class="cond-row"><div class="cind ci-warn"></div><div class="clbl">Spread &gt; 0.05%</div><div class="cval" style="color:var(--amb)">0.019% ⚠</div></div>
      <div class="cond-row"><div class="cind ci-met"></div><div class="clbl">LN Liquidity &gt; 100k sats</div><div class="cval up">482k ✓</div></div>
      <div class="cond-row"><div class="cind ci-met"></div><div class="clbl">SOL RPC reachable</div><div class="cval up">42ms ✓</div></div>
      <div class="cond-row"><div class="cind ci-met"></div><div class="clbl">P2P Peers &gt; 3</div><div class="cval up">14 ✓</div></div>
      <div class="cond-row"><div class="cind ci-unmet" id="ci-7"></div><div class="clbl">RSI(14) &lt; 40</div><div class="cval" style="color:var(--t3)" id="cv-7">48.2 ✗</div></div>
    </div>

    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-r">Order Depth</span></div>
      <div id="depth-asks"></div>
      <div class="dspr" id="d-spread">Spread · $18.40 · 0.019%</div>
      <div id="depth-bids"></div>
    </div>

    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-g">Wallet Balances</span></div>
      <div class="wr">
        <div class="wl"><div class="wicon wi-b">₿</div><div><div class="wname">Bitcoin</div><div class="wnet">Lightning</div></div></div>
        <div class="wright"><span class="wamt" style="color:#f7931a">0.4821 BTC</span><span class="wusd">≈ $46,448</span></div>
      </div>
      <div class="wr">
        <div class="wl"><div class="wicon wi-u">₮</div><div><div class="wname">USDT</div><div class="wnet">Solana SPL</div></div></div>
        <div class="wright"><span class="wamt" style="color:var(--grn)">12,480.00</span><span class="wusd">≈ $12,480</span></div>
      </div>
      <div class="wr">
        <div class="wl"><div class="wicon wi-s">◎</div><div><div class="wname">SOL</div><div class="wnet">Gas reserve</div></div></div>
        <div class="wright"><span class="wamt" style="color:var(--pur)">2.41 SOL</span><span class="wusd">≈ $408</span></div>
      </div>
      <div class="wr" style="border-bottom:none">
        <div class="wl"><div class="wicon wi-t">⬡</div><div><div class="wname">TNK</div><div class="wnet">Trac Network</div></div></div>
        <div class="wright"><span class="wamt" style="color:var(--cyan)">5,000 TNK</span><span class="wusd">Gas token</span></div>
      </div>
    </div>

    <div class="pnl">
      <div class="pnl-hdr"><span class="pnl-title pt-p">7-Day Performance</span></div>
      <div class="pbars" id="pbars"></div>
      <div class="pdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      <div class="mstats">
        <div class="msbox"><span class="msv up">+8.4%</span><span class="msl">Week ROI</span></div>
        <div class="msbox"><span class="msv" style="color:var(--cyan)">73</span><span class="msl">Total Swaps</span></div>
        <div class="msbox"><span class="msv" style="color:var(--amb)">$24</span><span class="msl">Avg Profit</span></div>
        <div class="msbox"><span class="msv" style="color:var(--t2)">97%</span><span class="msl">Win Rate</span></div>
      </div>
    </div>

  </div><!-- /right col -->

</div><!-- /layout -->

<!-- MODAL -->
<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-title">⚡ <span id="m-head">Review Trade</span></div>
    <div class="mrow"><span class="mkey">Agent</span>     <span class="mval cy"  id="m-agent">AutoBuy</span></div>
    <div class="mrow"><span class="mkey">Amount</span>    <span class="mval"     id="m-amount">50,000 sats</span></div>
    <div class="mrow"><span class="mkey">Direction</span> <span class="mval"     id="m-dir">BTC → USDT</span></div>
    <div class="mrow"><span class="mkey">Trigger</span>   <span class="mval"     id="m-trigger">price &lt; $96,200</span></div>
    <div class="mrow"><span class="mkey">Channel</span>   <span class="mval cy">0000intercomswapbtcusdt</span></div>
    <div class="mrow"><span class="mkey">Est. Out</span>  <span class="mval grn">~$4,817.50 USDT</span></div>
    <div class="mrow"><span class="mkey">Total Fee</span> <span class="mval">0.2% (~$9.64)</span></div>
    <div class="macts">
      <button class="bmod" onclick="closeModal()">Cancel</button>
      <button class="bmod ok" onclick="confirmTrade()">Confirm Swap</button>
    </div>
  </div>
</div>

<!-- TOASTS -->
<div id="toasts"></div>

<script>
'use strict';
/* ─── helpers ─── */
function ri(a,b){return Math.floor(Math.random()*(b-a+1))+a}
function rf(a,b){return Math.random()*(b-a)+a}
function ts(){return new Date().toTimeString().slice(0,8)}

/* ─── state ─── */
var price=96420, slot=325841182, pnl=128500, execs=22;
var agents={a1:'run',a2:'run',a3:'paused',a4:'run'};

/* ─── ticker ─── */
function buildTicker(){
  var items=[
    ['AGENT','AutoBuy triggered — RFQ posted on 0000intercomswapbtcusdt'],
    ['THRESHOLD','BTC/USDT dropped to $96,190 — condition met'],
    ['CHAIN','Solana escrow slot 325,841,129 confirmed · USDT claimed'],
    ['P2P','14 peers connected · channel 0000intercomswapbtcusdt active'],
    ['EXEC','50,000 sats acquired at $96,350 avg'],
    ['MONITOR','Arb spread 0.019% · watching for >0.05% trigger'],
    ['AGENT','AutoSell standing by · $97,500 target'],
    ['TRAC','TNK fork incentive · 500 TNK per eligible fork'],
  ];
  var seg=items.map(function(x){
    return '<span class="ti"><span class="ti-k">'+x[0]+'</span> <span class="ti-v">'+x[1]+'</span></span>';
  }).join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;');
  var el=document.getElementById('ticker-inner');
  if(el) el.innerHTML=seg+'&nbsp;&nbsp;&middot;&nbsp;&nbsp;'+seg;
}

/* ─── chart ─── */
function drawChart(){
  var W=900,H=210,pad=16,count=72,pts=[],p=94900;
  for(var i=0;i<count;i++){p+=rf(-260,265)*0.88;p=Math.max(91500,Math.min(99500,p));pts.push(p);}
  pts[count-1]=price;
  var mn=Math.min.apply(null,pts),mx=Math.max.apply(null,pts),rng=mx-mn||1;
  var X=function(i){return(i/(count-1))*W;};
  var Y=function(v){return H-pad-((v-mn)/rng)*(H-pad*2);};
  var coords=pts.map(function(v,i){return X(i).toFixed(1)+','+Y(v).toFixed(1);});
  document.getElementById('c-line').setAttribute('d','M'+coords.join('L'));
  document.getElementById('c-area').setAttribute('d','M0,'+H+' L'+coords.join('L')+' L'+W+','+H+' Z');

  var sy=Y(97500),by=Y(96200);
  ['l-sell','l-buy'].forEach(function(id){
    var el=document.getElementById(id);
    var y=id==='l-sell'?sy:by;
    el.setAttribute('y1',y.toFixed(1));el.setAttribute('y2',y.toFixed(1));
  });
  var ts2=document.getElementById('t-sell'),tb=document.getElementById('t-buy');
  if(ts2) ts2.setAttribute('y',Math.max(12,sy-4).toFixed(1));
  if(tb)  tb.setAttribute('y',Math.min(H-2,by+12).toFixed(1));

  var mg=document.getElementById('c-marks');
  mg.innerHTML='';
  [6,14,22,31,43,52,63].forEach(function(idx){
    if(idx>=count)return;
    var x=X(idx).toFixed(1),y=Y(pts[idx]).toFixed(1),buy=Math.random()>0.45;
    var col=buy?'var(--grn)':'var(--red)';
    mg.insertAdjacentHTML('beforeend',
      '<circle cx="'+x+'" cy="'+y+'" r="4" fill="'+col+'" stroke="#020408" stroke-width="1.5"/>'+
      '<line x1="'+x+'" y1="'+(parseFloat(y)+5)+'" x2="'+x+'" y2="'+H+'" stroke="'+col+'" stroke-width="1" opacity="0.1"/>');
  });
}

/* ─── crosshair ─── */
(function(){
  var svg=document.getElementById('main-svg');
  var cxl=document.getElementById('cx'),cxd=document.getElementById('cd');
  if(!svg)return;
  svg.addEventListener('mousemove',function(e){
    var r=svg.getBoundingClientRect();
    var rx=((e.clientX-r.left)/r.width)*900,ry=((e.clientY-r.top)/r.height)*210;
    cxl.setAttribute('x1',rx.toFixed(1));cxl.setAttribute('x2',rx.toFixed(1));
    cxl.setAttribute('visibility','visible');
    cxd.setAttribute('cx',rx.toFixed(1));cxd.setAttribute('cy',ry.toFixed(1));
    cxd.setAttribute('visibility','visible');
  });
  svg.addEventListener('mouseleave',function(){
    cxl.setAttribute('visibility','hidden');cxd.setAttribute('visibility','hidden');
  });
})();

/* ─── depth ─── */
function renderDepth(){
  var a=document.getElementById('depth-asks'),b=document.getElementById('depth-bids');
  if(!a||!b)return;a.innerHTML='';b.innerHTML='';
  var mx=85000;
  for(var i=7;i>=0;i--){
    var p2=(price+9+i*rf(6,28)).toFixed(0),vol=ri(3000,80000),pct=((vol/mx)*100).toFixed(0);
    a.insertAdjacentHTML('beforeend','<div class="depth-row"><div class="dbar dbar-a" style="width:'+pct+'%"></div>'+
      '<div class="dq">'+((vol/1e8).toFixed(4))+'</div>'+
      '<div class="dp ask">$'+Number(p2).toLocaleString()+'</div>'+
      '<div class="dq r">$'+((vol*Number(p2)/1e8).toFixed(0))+'</div></div>');
  }
  for(var j=0;j<8;j++){
    var p3=(price-9-j*rf(6,28)).toFixed(0),vol2=ri(3000,80000),pct2=((vol2/mx)*100).toFixed(0);
    b.insertAdjacentHTML('beforeend','<div class="depth-row"><div class="dbar dbar-b" style="width:'+pct2+'%"></div>'+
      '<div class="dq">'+((vol2/1e8).toFixed(4))+'</div>'+
      '<div class="dp bid">$'+Number(p3).toLocaleString()+'</div>'+
      '<div class="dq r">$'+((vol2*Number(p3)/1e8).toFixed(0))+'</div></div>');
  }
}

/* ─── perf bars ─── */
function renderPerf(){
  var data=[420,-80,315,180,-40,290,200];
  var wrap=document.getElementById('pbars');
  if(!wrap)return;wrap.innerHTML='';
  var mx=Math.max.apply(null,data.map(Math.abs));
  data.forEach(function(v){
    var el=document.createElement('div');
    el.className='pbar '+(v>=0?'pos':'neg');
    el.style.height=((Math.abs(v)/mx)*100)+'%';
    el.title='$'+(v>=0?'+':'')+v;
    wrap.appendChild(el);
  });
}

/* ─── events ─── */
var EVDEFS=[
  {chip:'ch-exec',chipTxt:'EXEC',dot:'var(--grn)',title:'AutoBuy Executed',
    detail:function(){return 'Swapped 50,000 sats → '+(price*0.0005*0.998).toFixed(2)+' USDT via LN→SOL escrow';}},
  {chip:'ch-trig',chipTxt:'TRIGGER',dot:'var(--cyan)',title:'Price Threshold Crossed',
    detail:function(){return 'BTC fell to $'+(price-ri(20,200)).toLocaleString()+' — AutoBuy condition met';}},
  {chip:'ch-wtch',chipTxt:'CHAIN',dot:'var(--cyan)',title:'Solana Escrow Confirmed',
    detail:function(){return 'Slot '+(slot-ri(100,1000)).toLocaleString()+' · USDT claimed (preimage verified)';}},
  {chip:'ch-rfq',chipTxt:'RFQ',dot:'var(--amb)',title:'RFQ Posted',
    detail:function(){return 'trade_'+Math.random().toString(36).slice(2,8)+' → 0000intercomswapbtcusdt · awaiting quote';}},
  {chip:'ch-exec',chipTxt:'EXEC',dot:'var(--grn)',title:'AutoSell Executed',
    detail:function(){return 'Swapped 30,000 sats → '+(price*0.0003*0.998).toFixed(2)+' USDT · above $97,500';}},
  {chip:'ch-alrt',chipTxt:'ALERT',dot:'var(--amb)',title:'Arb Agent Alert',
    detail:function(){return 'Spread 0.019% — below 0.05% threshold. Monitoring...';}},
  {chip:'ch-wtch',chipTxt:'CHAIN',dot:'var(--cyan)',title:'On-chain Event Detected',
    detail:function(){return 'Escrow updated at block '+(slot-ri(50,500)).toLocaleString();}}
];

function addEvent(def){
  var log=document.getElementById('evlog');
  var hdr=log&&log.querySelector('.evlog-hdr');
  if(!log||!hdr)return;
  var el=document.createElement('div');
  el.className='evitem';
  el.innerHTML='<div class="ev-time">'+ts()+'</div>'+
    '<div class="ev-track"><div class="ev-dot" style="background:'+def.dot+';box-shadow:0 0 8px '+def.dot+'"></div><div class="ev-line"></div></div>'+
    '<div class="ev-body">'+
    '<div class="ev-title"><span class="echip '+def.chip+'">'+def.chipTxt+'</span>'+def.title+'</div>'+
    '<div class="ev-detail">'+def.detail()+'</div>'+
    '</div>';
  hdr.insertAdjacentElement('afterend',el);
  var items=log.querySelectorAll('.evitem');
  if(items.length>30)items[items.length-1].remove();
}

function seedEvents(){
  [1,3,0,2,6,4,5].forEach(function(idx,i){setTimeout(function(){addEvent(EVDEFS[idx]);},i*75);});
}

/* ─── price tick ─── */
function tickPrice(){
  price+=rf(-115,118)*0.85;price=Math.max(91000,Math.min(100000,price));
  var fmt='$'+price.toLocaleString('en-US',{maximumFractionDigits:0});
  var hdrP=document.getElementById('h-price'),cP=document.getElementById('c-price');
  if(hdrP)hdrP.textContent=fmt;if(cP)cP.textContent=fmt;

  var c1=price<96200,c2=price>97500;
  var ci1=document.getElementById('ci-1'),ci2=document.getElementById('ci-2');
  var cv1=document.getElementById('cv-1'),cv2=document.getElementById('cv-2');
  if(ci1)ci1.className='cind '+(c1?'ci-met':'ci-unmet');
  if(ci2)ci2.className='cind '+(c2?'ci-met':'ci-unmet');
  if(cv1){cv1.textContent='$'+Math.round(price).toLocaleString()+' '+(c1?'✓':'✗');cv1.style.color=c1?'var(--grn)':'var(--red)';}
  if(cv2){cv2.textContent='$'+Math.round(price).toLocaleString()+' '+(c2?'✓':'✗');cv2.style.color=c2?'var(--grn)':'var(--t3)';}

  var rsi=rf(35,65),rsiMet=rsi<40;
  var ci7=document.getElementById('ci-7'),cv7=document.getElementById('cv-7');
  if(ci7)ci7.className='cind '+(rsiMet?'ci-met':'ci-unmet');
  if(cv7){cv7.textContent=rsi.toFixed(1)+(rsiMet?' ✓':' ✗');cv7.style.color=rsiMet?'var(--grn)':'var(--t3)';}

  if(c1&&agents.a1==='run'&&Math.random()<0.08){
    pnl+=ri(600,2800);execs++;updateStats();
    var a1e=document.getElementById('a1-execs');if(a1e)a1e.textContent=parseInt(a1e.textContent||'12')+1;
    addEvent(EVDEFS[0]);toast('exec','AutoBuy Executed','50k sats at $'+Math.round(price).toLocaleString());
  }

  slot+=ri(2,6);
  var se=document.getElementById('h-slot'),s4=document.getElementById('a4-slot');
  if(se)se.textContent=slot.toLocaleString();if(s4)s4.textContent=(slot/1e6).toFixed(1)+'M';
}

function updateStats(){
  var sp=document.getElementById('s-pnl'),se=document.getElementById('s-execs');
  var hp=document.getElementById('h-pnl'),he=document.getElementById('h-execs');
  if(sp)sp.textContent='+$'+(pnl/100).toFixed(0);
  if(se)se.textContent=execs;
  if(hp)hp.textContent='+$'+(pnl/100).toFixed(0);
  if(he)he.textContent='▲ '+execs+' trades';
}

/* ─── toast ─── */
function toast(type,title,detail,ms){
  ms=ms||4500;
  var ico={exec:'✅',alert:'⚠️',error:'❌',info:'ℹ️'};
  var c=document.getElementById('toasts');if(!c)return;
  var el=document.createElement('div');
  el.className='toast '+type;
  el.innerHTML='<div class="toast-ico">'+(ico[type]||'ℹ️')+'</div><div><div class="toast-t">'+title+'</div><div class="toast-d">'+detail+'</div></div>';
  c.appendChild(el);
  setTimeout(function(){
    el.classList.add('fading');
    el.addEventListener('animationend',function(){el.remove();});
  },ms);
}

/* ─── modal ─── */
function openModal(agent,amount,dir,trigger){
  document.getElementById('m-head').textContent='Review · '+agent;
  document.getElementById('m-agent').textContent=agent;
  document.getElementById('m-amount').textContent=amount;
  document.getElementById('m-dir').textContent=dir;
  document.getElementById('m-trigger').textContent=trigger;
  document.getElementById('modal-bg').classList.add('open');
}
function closeModal(){document.getElementById('modal-bg').classList.remove('open');}
function confirmTrade(){
  closeModal();
  var a=document.getElementById('m-agent').textContent;
  addEvent(EVDEFS[0]);
  toast('exec',a+' — Manual Execution','RFQ posted on 0000intercomswapbtcusdt');
  pnl+=ri(400,1800);execs++;updateStats();
}

/* ─── agent toggle ─── */
function toggleAgent(id,action){
  var card=document.getElementById('card-'+id),badge=document.getElementById('badge-'+id);
  if(!card||!badge)return;
  if(action==='pause'){
    agents[id]='paused';card.className='acard paused';
    badge.className='sbadge sb-pau';badge.textContent='PAUSED';
    toast('alert','Agent Paused',id+' paused');
  }else{
    agents[id]='run';card.className='acard run';
    badge.className='sbadge sb-run';badge.textContent='RUNNING';
    toast('exec','Agent Resumed',id+' is now active');
  }
}

/* ─── force + deploy ─── */
function forceRun(name){addEvent(EVDEFS[3]);toast('info',name+' Force Triggered','Posting RFQ regardless of conditions');}
function deployAgent(){
  var type=(document.getElementById('b-type').value||'').split('—')[0].trim();
  var ti=(document.getElementById('b-in').value||'').split(' ')[0];
  var to=(document.getElementById('b-out').value||'').split(' ')[0];
  var th=document.getElementById('b-thresh').value||'N/A';
  var am=document.getElementById('b-amount').value||'50000';
  toast('info','Deploying: '+type,ti+'→'+to+' · Threshold: '+th+' · Amount: '+am);
  addEvent(EVDEFS[3]);
  setTimeout(function(){toast('exec','Agent Deployed!',type+' active on 0000intercomswapbtcusdt');addEvent(EVDEFS[0]);},1800);
}

/* ─── tf buttons ─── */
document.querySelectorAll('.tf').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('.tf').forEach(function(b){b.classList.remove('active');});
    this.classList.add('active');drawChart();
  });
});

/* ─── random event pump ─── */
var evCursor=0;
function pumpEvent(){
  if(Math.random()<0.65){addEvent(EVDEFS[evCursor%EVDEFS.length]);evCursor++;}
  setTimeout(pumpEvent,ri(4500,10000));
}

/* ─── periodic toasts ─── */
var tmsgs=[
  ['info','Block Confirmed','Solana slot live · chain healthy'],
  ['exec','Quote Received','Maker quoted 50k sats at $96,340'],
  ['alert','Spread Narrowing','BTC-USDT spread now 0.015%'],
  ['exec','Escrow Claimed','USDT escrow auto-claimed by Chain Watcher'],
  ['info','Peer Connected','15 peers on 0000intercomswapbtcusdt'],
];
var tCursor=0;
function loopToast(){
  var m=tmsgs[tCursor%tmsgs.length];toast(m[0],m[1],m[2]);tCursor++;
  setTimeout(loopToast,ri(9000,20000));
}

/* ─── INIT ─── */
buildTicker();drawChart();renderDepth();renderPerf();seedEvents();updateStats();
setInterval(tickPrice,2400);setInterval(drawChart,16000);setInterval(renderDepth,3500);
setTimeout(pumpEvent,5000);setTimeout(loopToast,8000);
toast('info','AutoDEX Agent Online','4 agents active · P2P connected · 14 peers');
</script>
</body>
</html>
