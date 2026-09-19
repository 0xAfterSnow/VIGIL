export function BottomBar({ demo = false }: { demo?: boolean }) {
  return (
    <div className="ck-bottombar">
      <div className="ck-bottombar__left">
        <span className={`ck-fairness-dot${demo ? ' ck-fairness-dot--demo' : ''}`} aria-hidden />
        {demo ? 'Free play · demo chips' : 'Provably fair'}
      </div>
      <div className="ck-bottombar__center">
        <span className="ck-bottombar__logo">chain.wtf</span>
      </div>
      <div className="ck-bottombar__right">
        {demo ? 'Vigil · no real money' : 'Vigil · 96% RTP'}
      </div>
    </div>
  );
}
