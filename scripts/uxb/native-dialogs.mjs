// omowright auto-accepts JavaScript dialogs in its CDP transport. Observe a
// second session on this owned page, disabling only the SDK's Page events
// during each test so Cancel and Accept exercise the real browser dialog.
export async function nativeDialogs(page) {
  const {webSocketDebuggerUrl}=await fetch("http://127.0.0.1:9333/json/version").then(r=>r.json());
  const socket=new WebSocket(webSocketDebuggerUrl),pending=new Map();
  let sequence=0,sessionId,expected=null;
  await new Promise((resolve,reject)=>{
    socket.addEventListener("open",resolve,{once:true});
    socket.addEventListener("error",reject,{once:true});
  });
  function send(method,params={},session){
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},8000);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}));
    });
  }
  socket.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    if(message.id){
      const request=pending.get(message.id);
      if(!request)return;
      pending.delete(message.id);clearTimeout(request.timer);
      message.error?request.reject(Error(message.error.message)):request.resolve(message.result);
      return;
    }
    if(message.sessionId!==sessionId)return;
    if(message.method==="Page.javascriptDialogOpening"){
      if(!expected)return;
      expected.opening=message.params;
      if(message.params.type!=="confirm"){
        expected.reject(Error(`Expected confirm, received ${message.params.type}`));
        return;
      }
      void send("Page.handleJavaScriptDialog",{accept:expected.accept},sessionId).catch(expected.reject);
    }
    if(message.method==="Page.javascriptDialogClosed"&&expected){
      expected.closed=true;clearTimeout(expected.timer);
      expected.resolve({type:expected.opening?.type,accepted:message.params.result});
    }
  });
  ({sessionId}=await send("Target.attachToTarget",{targetId:page.targetId,flatten:true}));
  await send("Page.enable",{},sessionId);
  return {
    async confirm(accept,trigger){
      if(expected)throw Error("A native confirmation is already armed");
      await page._sendToTarget("Page.disable");
      const signal=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error("Native confirmation event timeout")),8000);
        expected={accept,resolve,reject,timer,opening:null,closed:false};
      });
      try{
        const [observed]=await Promise.all([signal,trigger()]);
        if(observed.accepted!==accept)throw Error("Native confirmation result did not match the requested action");
        return observed;
      }finally{
        clearTimeout(expected.timer);
        if(expected.opening&&!expected.closed)await send("Page.handleJavaScriptDialog",{accept:false},sessionId);
        expected=null;
        await page._sendToTarget("Page.enable");
      }
    },
    async close(){
      await send("Target.detachFromTarget",{sessionId});
      socket.close();
    },
  };
}
