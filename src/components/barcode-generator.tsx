import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeGeneratorProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  margin?: number;
  className?: string;
}

export const BarcodeGenerator: React.FC<BarcodeGeneratorProps> = ({
  value,
  format = 'CODE128',
  width = 1.6,
  height = 36,
  displayValue = true,
  fontSize = 11,
  margin = 2,
  className = '',
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format,
          width,
          height,
          displayValue,
          fontSize,
          margin,
          background: '#ffffff',
          lineColor: '#000000',
          fontOptions: 'bold',
        });
      } catch (err) {
        console.error('Erro ao gerar Código de Barras:', err);
      }
    }
  }, [value, format, width, height, displayValue, fontSize, margin]);

  if (!value) return null;

  return <svg ref={svgRef} className={`max-w-full ${className}`} />;
};
