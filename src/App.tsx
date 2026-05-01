import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Pencil, Droplet, Eraser, Move, Download, Image as ImageIcon, SplitSquareHorizontal, Pipette, Plus, Minus, Undo } from 'lucide-react';
import './App.css';

const CANVAS_SIZE = 64;
const DEFAULT_COLOR = '#000000';

type Tool = 'pen' | 'symmetry' | 'fill' | 'erase' | 'move' | 'eyedropper';

function App() {
  const [grid, setGrid] = useState<string[]>(Array(CANVAS_SIZE * CANVAS_SIZE).fill(''));
  const [history, setHistory] = useState<string[][]>([Array(CANVAS_SIZE * CANVAS_SIZE).fill('')]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  
  const [currentTool, setCurrentTool] = useState<Tool>('pen');
  const [currentColor, setCurrentColor] = useState<string>(DEFAULT_COLOR);
  const [customColors, setCustomColors] = useState<string[]>(() => {
    const saved = localStorage.getItem('pixelmaker_custom_colors');
    return saved ? JSON.parse(saved) : [];
  });
  const [referenceImg, setReferenceImg] = useState<string | null>(null);
  const [referenceOpacity, setReferenceOpacity] = useState<number>(0.5);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const moveSnapshot = useRef<string[]>([]);
  const startDrag = useRef<{x: number, y: number} | null>(null);

  // Save custom colors to cache
  useEffect(() => {
    localStorage.setItem('pixelmaker_custom_colors', JSON.stringify(customColors));
  }, [customColors]);

  // Handle Undo Shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex]);

  // Draw grid to canvas whenever it changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) {
        const x = i % CANVAS_SIZE;
        const y = Math.floor(i / CANVAS_SIZE);
        ctx.fillStyle = grid[i];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [grid]);

  const undo = useCallback(() => {
    setHistoryIndex(prev => {
      if (prev > 0) {
        const newIndex = prev - 1;
        setGrid(history[newIndex]);
        return newIndex;
      }
      return prev;
    });
  }, [history]);

  const saveHistory = (newGrid: string[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newGrid);
    if (newHistory.length > 50) newHistory.shift(); // Keep max 50 history states
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    const x = Math.floor((clientX - rect.left) * scaleX);
    const y = Math.floor((clientY - rect.top) * scaleY);
    
    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return null;
    return { x, y };
  };

  const drawPixel = (x: number, y: number, color: string, currentGrid: string[]) => {
    const index = y * CANVAS_SIZE + x;
    if (currentGrid[index] !== color) {
      currentGrid[index] = color;
      return true;
    }
    return false;
  };

  const floodFill = (x: number, y: number, targetColor: string, replacementColor: string, currentGrid: string[]) => {
    if (targetColor === replacementColor) return false;
    const startIdx = y * CANVAS_SIZE + x;
    if (currentGrid[startIdx] !== targetColor) return false;

    const queue: number[] = [startIdx];
    let changed = false;

    while (queue.length > 0) {
      const idx = queue.shift()!;
      if (currentGrid[idx] === targetColor) {
        currentGrid[idx] = replacementColor;
        changed = true;
        
        const cx = idx % CANVAS_SIZE;
        const cy = Math.floor(idx / CANVAS_SIZE);

        if (cx > 0) queue.push(idx - 1); // left
        if (cx < CANVAS_SIZE - 1) queue.push(idx + 1); // right
        if (cy > 0) queue.push(idx - CANVAS_SIZE); // up
        if (cy < CANVAS_SIZE - 1) queue.push(idx + CANVAS_SIZE); // down
      }
    }
    return changed;
  };

  const applyTool = (x: number, y: number, isContinuous: boolean = false) => {
    if (currentTool === 'eyedropper') {
      const color = grid[y * CANVAS_SIZE + x];
      if (color) setCurrentColor(color);
      return;
    }

    setGrid(prevGrid => {
      const newGrid = [...prevGrid];
      let changed = false;

      if (currentTool === 'pen') {
        changed = drawPixel(x, y, currentColor, newGrid);
      } else if (currentTool === 'erase') {
        changed = drawPixel(x, y, '', newGrid);
      } else if (currentTool === 'symmetry') {
        changed = drawPixel(x, y, currentColor, newGrid) || changed;
        const mirrorX = CANVAS_SIZE - 1 - x;
        changed = drawPixel(mirrorX, y, currentColor, newGrid) || changed;
      } else if (currentTool === 'fill' && !isContinuous) {
        const targetColor = newGrid[y * CANVAS_SIZE + x];
        changed = floodFill(x, y, targetColor, currentColor, newGrid);
      } else if (currentTool === 'move') {
        if (!startDrag.current) return prevGrid;
        const dx = x - startDrag.current.x;
        const dy = y - startDrag.current.y;
        
        if (dx === 0 && dy === 0) return prevGrid;

        const shiftedGrid = Array(CANVAS_SIZE * CANVAS_SIZE).fill('');
        for (let i = 0; i < moveSnapshot.current.length; i++) {
          if (moveSnapshot.current[i]) {
            const oldX = i % CANVAS_SIZE;
            const oldY = Math.floor(i / CANVAS_SIZE);
            const newX = oldX + dx;
            const newY = oldY + dy;
            
            if (newX >= 0 && newX < CANVAS_SIZE && newY >= 0 && newY < CANVAS_SIZE) {
              shiftedGrid[newY * CANVAS_SIZE + newX] = moveSnapshot.current[i];
            }
          }
        }
        return shiftedGrid;
      }

      return changed ? newGrid : prevGrid;
    });
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const coords = getCoordinates(e);
    if (!coords) return;
    
    if (currentTool === 'move') {
      startDrag.current = coords;
      moveSnapshot.current = [...grid];
    } else {
      applyTool(coords.x, coords.y, false);
    }
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    if ('touches' in e && e.cancelable) {
      e.preventDefault();
    }
    const coords = getCoordinates(e);
    if (!coords) return;
    applyTool(coords.x, coords.y, true);
  };

  const handlePointerUp = () => {
    if (isDrawing.current && currentTool !== 'eyedropper') {
      // Save state to history on release
      setGrid(currentGrid => {
        if (historyIndex === 0 && history[0] === currentGrid) return currentGrid; // No change initially
        if (history[historyIndex] !== currentGrid) {
          saveHistory(currentGrid);
        }
        return currentGrid;
      });
    }
    isDrawing.current = false;
    startDrag.current = null;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setReferenceImg(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Use toBlob instead of toDataURL to ensure correct file type and extension handling
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = 'pixelmaker.png';
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const addCustomColor = () => {
    if (customColors.length >= 10) return;
    if (!customColors.includes(currentColor)) {
      setCustomColors([...customColors, currentColor]);
    }
  };

  const removeCurrentColor = () => {
    setCustomColors(customColors.filter(c => c !== currentColor));
  };

  const removeCustomColor = (colorToRemove: string, e: React.MouseEvent) => {
    e.preventDefault();
    setCustomColors(customColors.filter(c => c !== colorToRemove));
  };

  return (
    <div className="app-container">
      <div className="toolbar">
        <button 
          className={`tool-btn ${currentTool === 'pen' ? 'active' : ''}`}
          onClick={() => setCurrentTool('pen')}
          title="그리기 (Pen)"
        >
          <Pencil size={24} />
          <span>그리기</span>
        </button>
        <button 
          className={`tool-btn ${currentTool === 'symmetry' ? 'active' : ''}`}
          onClick={() => setCurrentTool('symmetry')}
          title="대칭 그리기 (Symmetry)"
        >
          <SplitSquareHorizontal size={24} />
          <span>대칭</span>
        </button>
        <button 
          className={`tool-btn ${currentTool === 'fill' ? 'active' : ''}`}
          onClick={() => setCurrentTool('fill')}
          title="페인트툴 (Fill)"
        >
          <Droplet size={24} />
          <span>채우기</span>
        </button>
        <button 
          className={`tool-btn ${currentTool === 'erase' ? 'active' : ''}`}
          onClick={() => setCurrentTool('erase')}
          title="지우기 (Eraser)"
        >
          <Eraser size={24} />
          <span>지우기</span>
        </button>
        <button 
          className={`tool-btn ${currentTool === 'eyedropper' ? 'active' : ''}`}
          onClick={() => setCurrentTool('eyedropper')}
          title="스포이드 (Eyedropper)"
        >
          <Pipette size={24} />
          <span>스포이드</span>
        </button>
        <button 
          className={`tool-btn ${currentTool === 'move' ? 'active' : ''}`}
          onClick={() => setCurrentTool('move')}
          title="옮기기 (Move)"
        >
          <Move size={24} />
          <span>옮기기</span>
        </button>
        
        <button 
          className="tool-btn"
          onClick={undo}
          title="되돌리기 (Ctrl+Z)"
          disabled={historyIndex === 0}
          style={{ opacity: historyIndex === 0 ? 0.5 : 1 }}
        >
          <Undo size={24} />
          <span>되돌리기</span>
        </button>

        <div className="color-section">
          <div className="color-picker-container">
            <input 
              type="color" 
              value={currentColor} 
              onChange={(e) => setCurrentColor(e.target.value)} 
              className="color-picker"
              title="색상 선택"
            />
            <button 
              className="add-color-btn" 
              onClick={addCustomColor} 
              title={customColors.length >= 10 ? "최대 10개까지 추가 가능합니다" : "팔레트에 추가"}
              disabled={customColors.length >= 10}
              style={{ opacity: customColors.length >= 10 ? 0.5 : 1 }}
            >
              <Plus size={16} />
            </button>
            <button 
              className="add-color-btn remove" 
              onClick={removeCurrentColor} 
              title="현재 색상 제거"
            >
              <Minus size={16} />
            </button>
          </div>

          <div className="color-palette">
            {customColors.map((c, i) => (
              <div 
                key={`custom-${c}-${i}`}
                className={`color-swatch custom-swatch ${currentColor === c ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setCurrentColor(c)}
                onContextMenu={(e) => removeCustomColor(c, e)}
                title="우클릭으로 삭제"
              />
            ))}
          </div>
        </div>
      </div>

      <div className="canvas-area">
        <div className="canvas-wrapper">
          <div className="checkerboard"></div>
          {referenceImg && (
            <img 
              src={referenceImg} 
              alt="Reference" 
              className="reference-image" 
              style={{ opacity: referenceOpacity }} 
            />
          )}
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className={`main-canvas ${currentTool === 'eyedropper' ? 'cursor-pipette' : ''}`}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />
        </div>
      </div>

      <div className="right-panel">
        <div className="panel-section">
          <h3>참고 이미지</h3>
          <label className="upload-btn">
            <ImageIcon size={18} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
            이미지 불러오기
            <input 
              type="file" 
              accept="image/*" 
              style={{ display: 'none' }} 
              onChange={handleImageUpload} 
            />
          </label>
          {referenceImg && (
            <div>
              <label style={{ fontSize: '0.8rem', color: '#aaa' }}>투명도 조절</label>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                value={referenceOpacity}
                onChange={(e) => setReferenceOpacity(parseFloat(e.target.value))}
              />
            </div>
          )}
        </div>

        <button className="download-btn" onClick={handleDownload}>
          <Download size={18} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
          그림 다운로드
        </button>
      </div>
    </div>
  );
}

export default App;
