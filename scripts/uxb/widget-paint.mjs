/** Browser-native paint observations; geometry/data are deliberately separate. */
export function observePaint(node) {
  const style=getComputedStyle(node),box=node.getBoundingClientRect();
  const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  const rgba=color=>{
    if(color==="none")return "none";
    context.clearRect(0,0,1,1);context.fillStyle="transparent";context.fillStyle=color;context.fillRect(0,0,1,1);
    return [...context.getImageData(0,0,1,1).data];
  };
  let effectiveOpacity=1,visible=true;
  for(let current=node;current;current=current.parentElement){
    const s=getComputedStyle(current);
    const clip=s.clip?.match(/-?[\d.]+px/g)?.map(parseFloat);
    const fullyClipped=s.clipPath==="inset(50%)"||clip?.length===4&&(clip[1]<=clip[3]||clip[2]<=clip[0]);
    effectiveOpacity*=Number(s.opacity);
    visible&&=s.display!=="none"&&s.visibility==="visible"&&!fullyClipped;
  }
  const drawnStroke=element=>{
    const s=getComputedStyle(element),stroke=rgba(s.stroke);
    return Array.isArray(stroke)&&stroke[3]>0&&parseFloat(s.strokeWidth)>0&&Number(s.strokeOpacity)>0;
  };
  const stroked=node instanceof SVGElement&&(drawnStroke(node)||[...node.querySelectorAll("path,line,polyline")].some(drawnStroke));
  const hasGeometry=box.width>0&&box.height>0||stroked&&(box.width>0||box.height>0);
  const fill=rgba(style.fill);
  let fillPainted=Array.isArray(fill)&&fill[3]>0&&Number(style.fillOpacity)>0;
  if(fillPainted&&node instanceof SVGGeometryElement){
    fillPainted=false;
    if(visible&&effectiveOpacity>0&&hasGeometry&&node.localName!=="line"){
      const bounds=node.getBBox(),length=node.getTotalLength();
      const epsilon=Math.max(Math.min(bounds.width,bounds.height)*.0001,.000001);
      for(let i=1;i<9&&length>0&&!fillPainted;i++){
        const at=length*i/9,step=length*.0001,p=node.getPointAtLength(at);
        const a=node.getPointAtLength(Math.max(0,at-step)),b=node.getPointAtLength(Math.min(length,at+step));
        const norm=Math.hypot(b.x-a.x,b.y-a.y);
        if(norm>0)for(const sign of [-1,1])
          if(node.isPointInFill(new DOMPoint(p.x-sign*(b.y-a.y)/norm*epsilon,p.y+sign*(b.x-a.x)/norm*epsilon)))fillPainted=true;
      }
    }
  }
  const shadowPainted=style.boxShadow!=="none"&&style.boxShadow.split(/,\s*(?![^()]*\))/).some(layer=>{
    const color=layer.match(/(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\([^)]*\)/)?.[0],lengths=layer.replace(/(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\([^)]*\)/g,"").match(/-?[\d.]+px/g)??[];
    return color&&rgba(color)[3]>0&&lengths.some(value=>parseFloat(value)!==0);
  });
  return {tag:node.localName,visible:visible&&effectiveOpacity>0&&hasGeometry,
    effectiveOpacity,width:box.width,height:box.height,text:node.textContent?.trim(),
    fill,fillPainted,stroke:rgba(style.stroke),strokeWidth:style.strokeWidth,
    fillOpacity:style.fillOpacity,strokeOpacity:style.strokeOpacity,opacity:style.opacity,
    dash:style.strokeDasharray,radius:style.r,color:rgba(style.color),backgroundColor:rgba(style.backgroundColor),
    borderColor:rgba(style.borderTopColor),borderWidth:style.borderTopWidth,
    borderRightColor:rgba(style.borderRightColor),borderRightWidth:style.borderRightWidth,
    borderBottomColor:rgba(style.borderBottomColor),borderBottomWidth:style.borderBottomWidth,
    borderLeftColor:rgba(style.borderLeftColor),borderLeftWidth:style.borderLeftWidth,
    backgroundImage:style.backgroundImage,boxShadow:style.boxShadow,shadowPainted,
    display:style.display,listStyleType:style.listStyleType,
    fontSize:style.fontSize,lineHeight:style.lineHeight,
    pseudo:Object.fromEntries(["before","after","marker"].map(key=>{const s=getComputedStyle(node,`::${key}`);return[key,{content:s.content,color:rgba(s.color),backgroundColor:rgba(s.backgroundColor),backgroundImage:s.backgroundImage,opacity:s.opacity,display:s.display,visibility:s.visibility}]})),
    shape:node instanceof SVGElement?[...node.querySelectorAll("path,circle,rect,line,polyline,polygon")].map(e=>({
      tag:e.localName,attributes:Object.fromEntries([...e.attributes].filter(a=>["d","cx","cy","r","x","y","width","height","rx","x1","x2","y1","y2","points"].includes(a.name)).map(a=>[a.name,a.value])),
      paint:(()=>{const s=getComputedStyle(e);return {fill:rgba(s.fill),stroke:rgba(s.stroke),strokeWidth:s.strokeWidth,opacity:s.opacity,fillOpacity:s.fillOpacity,strokeOpacity:s.strokeOpacity,dash:s.strokeDasharray,visibility:s.visibility,display:s.display,linecap:s.strokeLinecap,linejoin:s.strokeLinejoin}})()
    })):undefined};
}

export const plotPaintFields=["fill","stroke","strokeWidth","fillOpacity","strokeOpacity","opacity","dash","effectiveOpacity"];
export const iconPaintFields=[...plotPaintFields,"color","width","height","shape"];
export function chartPaintCoverage({svg,plots,activeSeries},kind) {
  const required=["grid","axis","tick",...(activeSeries?["series",kind==="line"?"line":"bar",...(kind==="line"?["point"]:[])]:[])];
  return [{field:"required-svg",pass:svg},...required.map(kind=>({field:`required-kind:${kind}`,pass:plots.some(n=>n.kind===kind)}))];
}
export function comparePaint(actual,reference,fields=plotPaintFields) {
  return [{field:"visible",expected:true,actual:actual.visible,pass:actual.visible===true},
    ...fields.map(field=>({field,expected:reference[field],actual:actual[field],
      pass:JSON.stringify(actual[field])===JSON.stringify(reference[field])}))];
}

export function paintChannels(node,paint) {
  const channels=[],alpha=value=>Array.isArray(value)&&value[3]>0;
  if(node instanceof SVGElement){
    if(["text","tspan"].includes(node.localName)){
      const text=[...node.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
      if(text&&alpha(paint.fill))channels.push("fill");
      if(text&&alpha(paint.stroke)&&parseFloat(paint.strokeWidth)>0)channels.push("stroke");
    }
    else if(["path","rect","circle","line","polygon","polyline","ellipse"].includes(node.localName)){
      if(alpha(paint.fill)&&paint.fillPainted&&node.localName!=="line")channels.push("fill");
      if(alpha(paint.stroke)&&parseFloat(paint.strokeWidth)>0)channels.push("stroke");
    }
  }else{
    if([...node.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))channels.push("color");
    if(alpha(paint.backgroundColor))channels.push("backgroundColor");
    if(alpha(paint.borderColor)&&parseFloat(paint.borderWidth)>0)channels.push("borderColor");
    for(const side of ["Right","Bottom","Left"])if(alpha(paint[`border${side}Color`])&&parseFloat(paint[`border${side}Width`])>0)channels.push(`border${side}Color`);
    if(paint.backgroundImage!=="none")channels.push("backgroundImage");
    if(paint.shadowPainted)channels.push("boxShadow");
    for(const key of ["before","after"])if(paint.pseudo[key].display!=="none"&&paint.pseudo[key].visibility==="visible"&&Number(paint.pseudo[key].opacity)>0&&paint.pseudo[key].content&&!["none","normal"].includes(paint.pseudo[key].content)&&(paint.pseudo[key].content!=='""'||alpha(paint.pseudo[key].backgroundColor)||paint.pseudo[key].backgroundImage!=="none"))channels.push(`pseudo:${key}`);
    if(paint.display==="list-item"&&paint.listStyleType!=="none")channels.push("pseudo:marker");
  }
  return channels;
}

export function availablePaint(actual,expected) {
  if (!actual || !expected || !actual.visible) return false;
  if (expected.paint) {
    const fields = ["opacity","effectiveOpacity","fillOpacity","strokeOpacity","dash",
      ...expected.channels.flatMap(channel => channel.startsWith("pseudo:") ? ["pseudo"] :
        channel === "marker" ? ["listStyleType","pseudo"] : [channel])];
    if (expected.channels.includes("stroke")) fields.push("strokeWidth");
    for (const channel of expected.channels.filter(channel => channel.startsWith("border") && channel.endsWith("Color")))
      fields.push(channel.replace("Color","Width"));
    if (!expected.channels.length || fields.some(field => !Object.hasOwn(expected.paint,field))) return false;
  }
  if (expected.paint && Object.entries(expected.paint).some(
    ([field, value]) => value === undefined || JSON.stringify(actual[field]) !== JSON.stringify(value))) return false;
  return actual.visible&&expected.channels.every(channel=>{
    if(channel.startsWith("pseudo:")){
      const p=actual.pseudo[channel.slice(7)];
      if(!p||p.display==="none"||p.visibility!=="visible"||Number(p.opacity)<=0||p.content==="none")return false;
      if(channel==="pseudo:marker")return actual.display==="list-item"&&actual.listStyleType===expected.marker&&p.content!=='""'&&Array.isArray(p.color)&&p.color[3]>0;
      return !["normal",'""'].includes(p.content)||p.backgroundColor[3]>0||p.backgroundImage!=="none";
    }
    if(channel==="boxShadow")return actual.shadowPainted;
    if(channel==="backgroundImage")return actual.backgroundImage!=="none";
    const value=actual[channel];
    return Array.isArray(value)&&value[3]>0&&
      (channel!=="stroke"||Number(actual.strokeOpacity)>0&&parseFloat(actual.strokeWidth)>0)&&
      (channel!=="fill"||Number(actual.fillOpacity)>0)&&
      (channel!=="borderColor"||parseFloat(actual.borderWidth)>0)&&
      (!/^border(Right|Bottom|Left)Color$/.test(channel)||parseFloat(actual[channel.replace("Color","Width")])>0)&&
      (!["color","fill"].includes(channel)||!expected.text||Boolean(actual.text));
  });
}
