'use client';
import {Component,useEffect,useRef,useState,type ReactNode} from 'react';
import 'leaflet/dist/leaflet.css';
import {ShapePhysics} from './shape-physics';

function hasWebGL(){
 try{const canvas=document.createElement('canvas');return Boolean(canvas.getContext('webgl2')||canvas.getContext('webgl'));}catch{return false;}
}

function LeafletBackup(){
 const node=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  let cancelled=false;let cleanup=()=>{};
  void import('leaflet').then(module=>{
   if(cancelled||!node.current)return;
   const L=module.default;
   const map=L.map(node.current,{center:[20.59,78.96],zoom:4,zoomControl:true,attributionControl:false});
   cleanup=()=>{map.remove();};
  });
  return ()=>{cancelled=true;cleanup();};
 },[]);
 return <div ref={node} aria-label="Leaflet map fallback" style={{height:'100svh',width:'100%',background:'#0b0f14'}}/>;
}

class PhysicsBoundary extends Component<{fallback:ReactNode;children:ReactNode},{failed:boolean}>{
 state:{failed:boolean}={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:unknown){console.error('ShapePhysics unavailable, showing Leaflet backup',error);}
 render(){return this.state.failed?this.props.fallback:this.props.children;}
}

export function EasterEgg(){
 const [open,setOpen]=useState(false);
 const [webgl,setWebgl]=useState(true);
 useEffect(()=>{setWebgl(hasWebGL());},[]);
 useEffect(()=>{
  const toggle=(event:MouseEvent)=>{event.preventDefault();setOpen(current=>!current);};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
  window.addEventListener('contextmenu',toggle);
  window.addEventListener('keydown',escape);
  return ()=>{window.removeEventListener('contextmenu',toggle);window.removeEventListener('keydown',escape);};
 },[]);
 useEffect(()=>{
  if(!open)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow='hidden';
  return ()=>{document.body.style.overflow=previous;};
 },[open]);
 if(!open)return null;
 return <div className="easter-egg" role="dialog" aria-modal="true" aria-label="Shape physics easter egg. Right-click to close.">
  {webgl
   ?<PhysicsBoundary fallback={<LeafletBackup/>}><ShapePhysics height="100svh" count={315}/></PhysicsBoundary>
   :<LeafletBackup/>}
 </div>;
}
