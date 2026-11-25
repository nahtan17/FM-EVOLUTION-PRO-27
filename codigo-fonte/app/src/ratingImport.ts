/** Ratings are read from an FM export. Attribute/ability scores are never used as match ratings. */
export interface RatingPlayer{uid:number;name:string}
const clean=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().replace(/[^a-z0-9]/g,"");
function csv(text:string,separator:string):string[][]{
 const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===separator&&!quoted){row.push(cell.trim());cell=""}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=""}else cell+=c}
 row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
}
export function importRatings(text:string,players:readonly RatingPlayer[]):{ratings:Record<number,number>;imported:number;skipped:number}{
 let rows:string[][];
 if(/<table[\s>]/i.test(text)){const doc=new DOMParser().parseFromString(text,"text/html");rows=Array.from(doc.querySelectorAll("tr"),tr=>Array.from(tr.querySelectorAll("th,td"),td=>td.textContent?.trim()??""))}
 else{const line=text.split(/\r?\n/).find(l=>l.trim())??"";const separator=["\t",";",","].sort((a,b)=>line.split(b).length-line.split(a).length)[0];rows=csv(text.replace(/^\uFEFF/,""),separator)}
 const ratingNames=new Set(["notamedia","media","averagerating","avrat","avgrating","avgr","rat","medrat"]),idNames=new Set(["id","uid","uniqueid","idunico","identificador"]),nameNames=new Set(["nome","name","jogador","player"]);
 const headerIndex=rows.findIndex(row=>row.some(value=>ratingNames.has(clean(value))));
 if(headerIndex<0)throw Error("O arquivo precisa ter a coluna Nota Média (ou Average Rating), além do ID ou nome do jogador.");
 const header=rows[headerIndex].map(clean),ratingAt=header.findIndex(v=>ratingNames.has(v)),idAt=header.findIndex(v=>idNames.has(v)),nameAt=header.findIndex(v=>nameNames.has(v));
 if(idAt<0&&nameAt<0)throw Error("Inclua o ID único ou o nome do jogador no arquivo exportado.");
 const unique=[...new Map(players.map(p=>[p.uid,p])).values()],known=new Set(unique.map(p=>p.uid));const byName=new Map<string,number[]>();for(const p of unique){const key=clean(p.name);byName.set(key,[...(byName.get(key)??[]),p.uid])}
 const ratings:Record<number,number>={},duplicates=new Set<number>();let skipped=0;
 for(const row of rows.slice(headerIndex+1)){
  const value=Number((row[ratingAt]??"").trim().replace(",","."));if(!row[ratingAt]?.trim()||!Number.isFinite(value)||value<0||value>10||/^[—–-]$/.test(row[ratingAt])){skipped++;continue}
  let uid=idAt>=0?Number((row[idAt]??"").replace(/[\s.]/g,"")):NaN;
  if(idAt<0){const found=byName.get(clean(row[nameAt]??""));uid=found?.length===1?found[0]:NaN}
  if(!Number.isInteger(uid)||!known.has(uid)||duplicates.has(uid)){skipped++;continue}
  if(uid in ratings){delete ratings[uid];duplicates.add(uid);skipped+=2;continue}
  ratings[uid]=value;
 }
 const imported=Object.keys(ratings).length;if(!imported)throw Error("Nenhuma nota válida correspondeu aos jogadores deste clube. Confira os IDs, nomes e a coluna de notas.");
 return {ratings,imported,skipped};
}
