/** Omowright restores its cached viewport on navigation; pin both the CDP and cached state. */
export async function applyViewport(page,{width,height,deviceScaleFactor=1,mobile=false,coarse=false}){
  await page._sendToTarget("Emulation.setDeviceMetricsOverride",{
    width,height,deviceScaleFactor,mobile,screenWidth:width,screenHeight:height,
  });
  await page._sendToTarget("Emulation.setTouchEmulationEnabled",{enabled:coarse,maxTouchPoints:coarse?5:1});
  page.setCachedViewportSize({width,height});
}
