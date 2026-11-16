'use client';
import {useEffect,useRef} from 'react';

export type FAQItem={question:string;answer:string};
export function FAQ({items,heading='Frequently asked questions'}:{items:FAQItem[];heading?:string}){
  const containerRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!containerRef.current)return;
    const details=containerRef.current.querySelectorAll('details');
    const handler=(e:Event)=>{
      const open=(e.target as HTMLDetailsElement);
      details.forEach(d=>{if(d!==open&&d.open)d.open=false;});
    };
    details.forEach(d=>d.addEventListener('toggle',handler));
    return()=>{details.forEach(d=>d.removeEventListener('toggle',handler));};
  },[items]);
  return (
    <section className="lux-faq">
      <h2>{heading}</h2>
      <div ref={containerRef} className="lux-faq-list">
        {items.map((item,i)=>(
          <details key={i} open={i===0}>
            <summary>
              <span>{item.question}</span>
              <span aria-hidden="true" className="lux-faq-plus"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1"><path d="M6 1v10M1 6h10"/></svg></span>
            </summary>
            <div className="lux-faq-answer"><p>{item.answer}</p></div>
          </details>
        ))}
      </div>
    </section>
  );
}
