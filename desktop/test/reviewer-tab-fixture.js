// Mount the actual Diké registered page; only its host transport is fictitious.
import {createRoot} from 'react-dom/client'
import plugin from '../src/plugin.src.js'
const calls=[], registrations=[]
const api=async(path,opts={})=>{
 calls.push({path,body:opts.body})
 const response=await fetch(path,{method:opts.method||'GET',headers:{'Content-Type':'application/json'},...(opts.body?{body:JSON.stringify(opts.body)}:{})})
 const data=await response.json()
 if(!response.ok)throw Error(data.detail?.code||JSON.stringify(data.detail))
 return data
}
plugin.register({rest:api,storage:{get:async()=>null,set:async()=>{}},registerMany:rows=>registrations.push(...rows)})
const page=registrations.find(x=>x.id==='page')
window.fixture={calls,registrations:registrations.map(x=>x.id)}
createRoot(document.getElementById('root')).render(page.render())
