import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOlistVariation,olistVariantExternalId} from '../../src/lib/olist-grade-parser.ts';
import {readOlistPrices,effectiveVariantPrice} from '../../src/lib/catalog-pricing.ts';
test('color-only accessory keeps color, never treats its SKU as size',()=>{
  assert.deepEqual(parseOlistVariation({id:'7',codigo:'10613',grade:{COR:'PINK'}}),{color:'PINK',size:'ÚNICO'});
  assert.deepEqual(parseOlistVariation({codigo:'M'}),{color:null,size:'ÚNICO'});
});
test('parses explicit sizes in any order, including TAM. and numeric sizing',()=>{
  assert.deepEqual(parseOlistVariation({grade:[{nome:'TAM.',valor:'M'},{chave:'Cor',valor:'Preto'}]}),{color:'Preto',size:'M'});
  assert.equal(parseOlistVariation({grade:{'Numeração':38}}).size,'38');
  assert.equal(parseOlistVariation({grade:{'Formato':'Grande','Cor':'Azul'}}).size,'ÚNICO');
});
test('does not invent size from arbitrary description or loose color',()=>{
  assert.equal(parseOlistVariation({descricao:'Garrafa azul',codigo:'99'}).size,'ÚNICO');
  assert.deepEqual(parseOlistVariation({grade:['Azul']}),{color:'Azul',size:'ÚNICO'});
  assert.equal(parseOlistVariation({descricao:'GG'}).size,'GG');
});
test('real source IDs and source-code fallback IDs remain stable',()=>{
  const v={id:'339812044',codigo:'10613',grade:{COR:'PINK'}};
  assert.equal(olistVariantExternalId('parent',v,parseOlistVariation(v)),'339812044');
  const noId={codigo:'10613',grade:{COR:'PINK'}};
  assert.equal(olistVariantExternalId('parent',noId,parseOlistVariation(noId)),'parent:10613');
});
test('preserves normal and promotional variant prices separately',()=>{
  const prices=readOlistPrices({preco:89.9,preco_promocional:39.99});
  assert.deepEqual(prices,{sale_price:89.9,promotional_price:39.99});
  assert.equal(effectiveVariantPrice(prices),39.99);
});
test('does not inherit unrelated parent promotion or coerce explicit zero',()=>{
  assert.equal(effectiveVariantPrice({sale_price:59.9},{sale_price:89.9,promotional_price:39.99}),59.9);
  assert.equal(effectiveVariantPrice({},{sale_price:89.9,promotional_price:39.99}),39.99);
  assert.equal(readOlistPrices({preco:0},{preco:159.9}).sale_price,0);
  assert.equal(effectiveVariantPrice({sale_price:0},{sale_price:159.9}),0);
});
test('rejects invalid or missing source money and invalid promotions',()=>{
  for(const preco of [-1,'abc',true,Infinity])assert.throws(()=>readOlistPrices({preco}));
  assert.throws(()=>readOlistPrices({}));
  assert.throws(()=>readOlistPrices({preco:10,preco_promocional:20}));
});
