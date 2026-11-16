// Fictitious host only: no model, profile, gateway, or inference can be invoked.
export const ROUTES_AREA='routes', SIDEBAR_NAV_AREA='sidebar', PALETTE_AREA='palette'
const reject=async()=>{throw Error('No gateway/model in reviewer tab fixture')}
export const host={state:{profile:{get:()=> 'fixture'}},navigate:()=>{},onEvent:()=>()=>{},request:reject,requestProfile:reject,profileRoutes:async()=>[],retainProfile:async()=>()=>{}}
