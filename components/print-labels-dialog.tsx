import React, { useState } from 'react';
import { BarcodeGenerator } from './barcode-generator';
import { Printer, X, Plus, Minus, Tag, LayoutGrid, ScrollText } from 'lucide-react';

export interface LabelItem {
  id: string;
  name: string;
  sku: string;
  price: number;
  color?: string;
  size?: string;
  quantity: number;
}

interface PrintLabelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialItems: LabelItem[];
  storeName?: string;
}

export type PrintFormat = 'thermal-50x30' | 'thermal-40x25' | 'a4-pimaco';

export const PrintLabelsDialog: React.FC<PrintLabelsDialogProps> = ({
  isOpen,
  onClose,
  initialItems,
  storeName = 'FitGestor',
}) => {
  const [items, setItems] = useState<LabelItem[]>(initialItems);
  const [format, setFormat] = useState<PrintFormat>('thermal-50x30');
  const [showPrice, setShowPrice] = useState(true);
  const [showStoreName, setShowStoreName] = useState(true);

  // Sincronizar itens quando a prop initialItems for alterada
  React.useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems(initialItems);
    }
  }, [initialItems]);

  if (!isOpen) return null;

  const updateQuantity = (id: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const handlePrint = () => {
    window.print();
  };

  // Gerar lista expandida com todas as cópias selecionadas
  const expandedLabels = items.flatMap((item) =>
    Array.from({ length: item.quantity }, (_, idx) => ({ ...item, copyIndex: idx }))
  );

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <>
      {/* CSS Exclusivo de Impressão */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #print-labels-area, #print-labels-area * {
            visibility: visible !important;
          }
          #print-labels-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 0;
            size: auto;
          }
          .label-page-break {
            break-after: page;
            page-break-after: always;
          }
        }
      `}</style>

      {/* Modal na Tela (no-print) */}
      <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
          
          {/* Topo do Modal */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Impressão de Etiquetas com Código de Barras</h3>
                <p className="text-xs text-slate-500">Configure as quantidades, o formato da etiqueta e imprima</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Conteúdo do Modal - 2 Colunas */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200">
            
            {/* Coluna Esquerda: Configurações & Lista de Produtos */}
            <div className="md:col-span-6 p-6 overflow-y-auto space-y-6 bg-slate-50/50">
              
              {/* Formato da Impressão */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Formato do Papel / Impressora
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormat('thermal-50x30')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 text-xs transition-all ${
                      format === 'thermal-50x30'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-semibold ring-2 ring-indigo-600/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <ScrollText className="w-4 h-4 text-indigo-600" />
                    <span>Rolo 50x30mm</span>
                    <span className="text-[10px] text-slate-400">Térmica Padrão</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat('thermal-40x25')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 text-xs transition-all ${
                      format === 'thermal-40x25'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-semibold ring-2 ring-indigo-600/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <ScrollText className="w-4 h-4 text-indigo-600" />
                    <span>Rolo 40x25mm</span>
                    <span className="text-[10px] text-slate-400">Térmica Compacta</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormat('a4-pimaco')}
                    className={`p-3 rounded-xl border text-left flex flex-col gap-1 text-xs transition-all ${
                      format === 'a4-pimaco'
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-900 font-semibold ring-2 ring-indigo-600/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4 text-indigo-600" />
                    <span>Folha A4 Pimaco</span>
                    <span className="text-[10px] text-slate-400">3 Colunas (Adesiva)</span>
                  </button>
                </div>
              </div>

              {/* Opções de Exibição */}
              <div className="flex items-center gap-6 pt-2 border-t border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showStoreName}
                    onChange={(e) => setShowStoreName(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Exibir Nome da Loja</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Exibir Preço de Venda</span>
                </label>
              </div>

              {/* Lista de Itens */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Quantidade de Cópias por Item
                </label>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl shadow-sm"
                    >
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs font-bold text-slate-800 truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{item.sku}</span>
                          {(item.color || item.size) && (
                            <span>
                              {item.color} {item.size ? `• TAM: ${item.size}` : ''}
                            </span>
                          )}
                          <span className="font-semibold text-slate-700">{formatCurrency(item.price)}</span>
                        </div>
                      </div>

                      {/* Controle de Quantidade */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, -1)}
                          className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-slate-800">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, 1)}
                          className="p-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Coluna Direita: Pré-Visualização */}
            <div className="md:col-span-6 p-6 flex flex-col bg-slate-100/70 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-600" /> Pré-Visualização das Etiquetas ({expandedLabels.length})
                </span>
                <span className="text-[11px] font-medium text-slate-500">Formato: {format}</span>
              </div>

              {/* Área de Visualização com Scroll */}
              <div className="flex-1 overflow-y-auto p-4 bg-slate-200/50 rounded-2xl border border-slate-300/50 flex flex-wrap justify-center gap-3">
                {expandedLabels.map((lbl, idx) => (
                  <div
                    key={`${lbl.id}-${idx}`}
                    className={`bg-white border border-slate-300 rounded shadow-md flex flex-col items-center justify-between text-center overflow-hidden bg-white text-black p-1.5 ${
                      format === 'thermal-50x30'
                        ? 'w-[190px] h-[115px]'
                        : format === 'thermal-40x25'
                        ? 'w-[155px] h-[95px]'
                        : 'w-[180px] h-[110px]'
                    }`}
                  >
                    {/* Marca da Loja */}
                    {showStoreName && (
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 leading-tight">
                        {storeName}
                      </span>
                    )}

                    {/* Nome do Produto */}
                    <p className="text-[10px] font-bold text-slate-900 leading-tight line-clamp-1 w-full px-1">
                      {lbl.name}
                    </p>

                    {/* Cor/Tamanho + Preço */}
                    <div className="flex items-center justify-between w-full px-1 text-[9px] font-bold text-slate-800">
                      <span>{lbl.color ? `${lbl.color} ${lbl.size || ''}` : lbl.size || ''}</span>
                      {showPrice && <span className="text-indigo-900 font-extrabold">{formatCurrency(lbl.price)}</span>}
                    </div>

                    {/* Código de Barras */}
                    <div className="w-full flex justify-center my-0.5">
                      <BarcodeGenerator
                        value={lbl.sku}
                        width={format === 'thermal-40x25' ? 1.2 : 1.5}
                        height={format === 'thermal-40x25' ? 24 : 30}
                        fontSize={10}
                        margin={0}
                      />
                    </div>
                  </div>
                ))}
              </div>

            </div>

          </div>

          {/* Rodapé do Modal com Botões */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
            <span className="text-xs font-semibold text-slate-600">
              Total de Etiquetas: <strong className="text-indigo-600">{expandedLabels.length} cópias</strong>
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handlePrint}
                disabled={expandedLabels.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Etiquetas</span>
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ÁREA OCULTA PARA IMPRESSÃO REAL (#print-labels-area) */}
      <div id="print-labels-area" className="hidden">
        {format === 'a4-pimaco' ? (
          <div className="grid grid-cols-3 gap-2 p-4 w-full">
            {expandedLabels.map((lbl, idx) => (
              <div
                key={`print-${lbl.id}-${idx}`}
                className="w-[66mm] h-[25mm] border border-slate-200 p-1 flex flex-col items-center justify-between text-center overflow-hidden bg-white text-black"
              >
                {showStoreName && <span className="text-[8px] font-bold uppercase">{storeName}</span>}
                <p className="text-[9px] font-bold leading-tight truncate w-full">{lbl.name}</p>
                <div className="flex justify-between w-full px-1 text-[8px] font-bold">
                  <span>{lbl.color} {lbl.size}</span>
                  {showPrice && <span>{formatCurrency(lbl.price)}</span>}
                </div>
                <BarcodeGenerator value={lbl.sku} width={1.3} height={22} fontSize={9} margin={0} />
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full">
            {expandedLabels.map((lbl, idx) => (
              <div
                key={`print-roll-${lbl.id}-${idx}`}
                className={`label-page-break flex flex-col items-center justify-between text-center overflow-hidden bg-white text-black p-1 ${
                  format === 'thermal-50x30' ? 'w-[50mm] h-[30mm]' : 'w-[40mm] h-[25mm]'
                }`}
              >
                {showStoreName && <span className="text-[8px] font-bold uppercase text-black">{storeName}</span>}
                <p className="text-[9px] font-bold text-black leading-tight truncate w-full">{lbl.name}</p>
                <div className="flex justify-between w-full px-1 text-[8px] font-bold text-black">
                  <span>{lbl.color} {lbl.size}</span>
                  {showPrice && <span>{formatCurrency(lbl.price)}</span>}
                </div>
                <BarcodeGenerator value={lbl.sku} width={1.3} height={22} fontSize={9} margin={0} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
