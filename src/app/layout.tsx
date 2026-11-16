import type { Metadata } from 'next';
import '../styles/glass.css';
import './globals.css';
import './atlas.css';
import {FAQ} from '@/components/faq';
import {EasterEgg} from '@/components/easter-egg';
export const metadata: Metadata = {title:'Budgetium — Follow the money',description:'Public works. Original records. Clear questions.',robots:{index:false,follow:false}};
const faqItems=[
  {question:'What is Budgetium?',answer:'A public map of development funding, contracts and evidence, rebuilt without proprietary imagery tokens.'},
  {question:'How is the data verified?',answer:'Every project location links back to an original government record, contract, or payment ledger.'},
  {question:'Can anyone contribute?',answer:'No — contributions require verified administrative access and documented source identity.'},
  {question:'Why is satellite imagery missing?',answer:'The open preview uses free global tiles; premium satellite layers require separate licensing.'}
];
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en" className="lux-shell"><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" /><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet"/></head><body style={{background:'var(--dp-color-ground)',color:'var(--dp-color-ink)',fontFamily:'var(--dp-typography-sans)'}} className="antialiased">{children}<FAQ items={faqItems}/><footer className="lux-footer"><div className="lux-footer-inner"><div className="lux-footer-top"><span className="lux-footer-tag">Budgetium</span><div className="lux-footer-links"><a href="#">About</a><a href="#">Terms</a><a href="#">Contact</a></div><a href="#top">Back to top</a></div><div className="lux-footer-wordmark" aria-hidden="true">Budgetium</div><div className="lux-footer-legal"><span>Budgetium. Public works. Original records.</span><span>MIT License.</span></div></div></footer><EasterEgg/></body></html>;
}
