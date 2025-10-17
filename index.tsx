/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Modality } from "@google/genai";

interface LineItem {
  item: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
}

interface QuoteSummary {
  subtotal: number;
  overhead: number;
  contingency: number;
  tax: number;
  grandTotal: number;
  disclaimer: string;
}

interface Quote {
  lineItems: LineItem[];
  summary: QuoteSummary;
}

interface SavedProject {
  id: string;
  name: string;
  filePreview: string;
  fileName: string;
  fileType: string;
  roomType: string;
  region: string;
  scope: string;
  style: StylePreset;
  quote: Quote | null;
  generatedImage: string | null;
  overheadPercent: number;
  contingencyPercent: number;
}

type Tab = 'quote' | 'render';
type StylePreset = 'Modern' | 'Farmhouse' | 'Scandinavian' | 'Industrial' | 'Coastal' | 'Minimalist' | 'Bohemian' | 'Mid-Century Modern';
type Theme = 'light' | 'dark';
type Region = 'QC_MONTREAL' | 'ON_TORONTO' | 'NYC';

const TAX_RATES: { [key in Region]: number } = {
  QC_MONTREAL: 14.975,
  ON_TORONTO: 13,
  NYC: 8.875,
};

const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  return (
    <div className="tooltip-container">
      {children}
      <span className="tooltip-text" dangerouslySetInnerHTML={{ __html: text }}></span>
    </div>
  );
};

const App: React.FC = () => {
  const [projectName, setProjectName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [roomType, setRoomType] = useState('Kitchen');
  const [region, setRegion] = useState<Region>('QC_MONTREAL');
  const [scope, setScope] = useState('');
  const [style, setStyle] = useState<StylePreset>('Modern');
  
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [isRenderLoading, setIsRenderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('quote');
  
  const [quote, setQuote] = useState<Quote | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [showStyleSelector, setShowStyleSelector] = useState(false);

  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [bumpPercent, setBumpPercent] = useState('10');

  const [overheadPercent, setOverheadPercent] = useState(10);
  const [contingencyPercent, setContingencyPercent] = useState(5);
  
  const currentTaxRate = TAX_RATES[region];

  const sliderRef = useRef<HTMLInputElement>(null);
  const afterImageRef = useRef<HTMLImageElement>(null);
  const sliderHandleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedProjects = localStorage.getItem('renovationProjects');
      if (storedProjects) {
        setSavedProjects(JSON.parse(storedProjects));
      }
      const savedTheme = localStorage.getItem('theme') as Theme || 'dark';
      setTheme(savedTheme);
      document.body.className = `${savedTheme}-theme`;
    } catch (e) {
      console.error("Failed to load data from localStorage", e);
    }
  }, []);
  
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.body.className = `${newTheme}-theme`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  };

  const generateQuote = async () => {
    if (!file || !scope || !projectName) {
      setError('Please provide a project name, upload a photo, and describe the scope of work to generate a quote.');
      return;
    }

    setIsQuoteLoading(true);
    setError(null);
    setQuote(null);
    setActiveTab('quote');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const imagePart = await fileToGenerativePart(file);

      const quotePrompt = `You are an expert renovation contractor. Before providing rates, perform a deep analysis of current, typical labor costs for licensed and insured tradespeople in the ${region} metropolitan area. The rates must be realistic and competitive for this specific locale.
Analyze the attached image of a ${roomType} and the following scope of work to create a detailed line-item quote. The scope is: "${scope}".

The quote must be for LABOR AND INSTALLATION ONLY. It should cover standard consumables (e.g., screws, caulk) but explicitly exclude the cost of major materials (e.g., flooring, paint, tiles, fixtures).

Provide quantities (sq ft, linear ft, count), unit rates, and totals. Calculate a summary with a ${overheadPercent}% overhead, ${contingencyPercent}% contingency, and the correct local tax for the ${region} area. The summary must include a disclaimer about this being a labor-only quote.

Respond ONLY with a JSON object matching the provided schema.`;

      const quoteSchema = {
        type: Type.OBJECT,
        properties: {
          lineItems: {
            type: Type.ARRAY,
            description: "List of all renovation tasks with costs.",
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING, description: "Description of the task." },
                quantity: { type: Type.NUMBER, description: "Quantity of work." },
                unit: { type: Type.STRING, description: "Unit of measurement (e.g., sqft, lf, each)." },
                rate: { type: Type.NUMBER, description: "Cost per unit for labor." },
                total: { type: Type.NUMBER, description: "Line item total cost." },
              },
              required: ["item", "quantity", "unit", "rate", "total"],
            },
          },
          summary: {
            type: Type.OBJECT,
            properties: {
              subtotal: { type: Type.NUMBER },
              overhead: { type: Type.NUMBER },
              contingency: { type: Type.NUMBER },
              tax: { type: Type.NUMBER },
              grandTotal: { type: Type.NUMBER },
              disclaimer: { type: Type.STRING, description: "A disclaimer stating this is a labor-only quote and does not include major materials." }
            },
            required: ["subtotal", "overhead", "contingency", "tax", "grandTotal", "disclaimer"],
          },
        },
        required: ["lineItems", "summary"],
      };

      const quoteResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, { text: quotePrompt }] },
        config: {
          responseMimeType: "application/json",
          responseSchema: quoteSchema,
        },
      });

      const quoteJson = JSON.parse(quoteResponse.text);
      // Immediately recalculate with the frontend's source-of-truth tax rate
      setQuote(recalculateQuote(quoteJson.lineItems, quoteJson.summary.disclaimer));

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate quote. ${errorMessage}`);
    } finally {
      setIsQuoteLoading(false);
    }
  };

  const generateRender = async () => {
    if (!file || !scope || !projectName) {
      setError('Please provide a project name, upload a photo, and describe the scope of work to generate a render.');
      return;
    }
    
    setShowStyleSelector(true);
    setIsRenderLoading(true);
    setError(null);
    setGeneratedImage(null);
    setActiveTab('render');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const imagePart = await fileToGenerativePart(file);

      const renderPrompt = `Given the attached 'before' image of a ${roomType}, generate a photorealistic 'after' image of the completed renovation. The desired new style is ${style}. The scope of work is: "${scope}". The final image should be a high-quality, photorealistic 'after' shot, showing the finished room from the same perspective as the original photo.`;

      const renderResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [imagePart, { text: renderPrompt }] },
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      const firstPart = renderResponse?.candidates?.[0]?.content?.parts[0];
      if (firstPart && 'inlineData' in firstPart) {
          const base64Image = firstPart.inlineData.data;
          setGeneratedImage(`data:${firstPart.inlineData.mimeType};base64,${base64Image}`);
      } else {
        throw new Error("Image generation failed to return an image.");
      }

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate render. ${errorMessage}`);
    } finally {
      setIsRenderLoading(false);
    }
  };

  const saveProject = () => {
    if (!projectName || (!quote && !generatedImage) || !filePreview || !file) {
        alert("Please generate a quote or render and provide a project name before saving.");
        return;
    }

    const newProject: SavedProject = {
      id: currentProjectId || Date.now().toString(),
      name: projectName,
      filePreview: filePreview,
      fileName: file.name,
      fileType: file.type,
      roomType,
      region,
      scope,
      style,
      quote,
      generatedImage,
      overheadPercent,
      contingencyPercent,
    };

    const otherProjects = savedProjects.filter(p => p.id !== newProject.id);
    const updatedProjects = [...otherProjects, newProject].sort((a, b) => a.name.localeCompare(b.name));
    
    setSavedProjects(updatedProjects);
    setCurrentProjectId(newProject.id);
    localStorage.setItem('renovationProjects', JSON.stringify(updatedProjects));
    alert('Project saved successfully!');
  };

  const handleLoadProject = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = e.target.value;
    if (!projectId) {
        setProjectName('');
        setFile(null);
        setFilePreview(null);
        setRoomType('Kitchen');
        setRegion('QC_MONTREAL');
        setScope('');
        setStyle('Modern');
        setQuote(null);
        setGeneratedImage(null);
        setCurrentProjectId(null);
        setError(null);
        setShowStyleSelector(false);
        setOverheadPercent(10);
        setContingencyPercent(5);
        return;
    }
    
    const projectToLoad = savedProjects.find(p => p.id === projectId);
    if (projectToLoad) {
        setProjectName(projectToLoad.name);
        setFile(null);
        setFilePreview(projectToLoad.filePreview);
        setRoomType(projectToLoad.roomType);
        setRegion(projectToLoad.region as Region);
        setScope(projectToLoad.scope);
        setStyle(projectToLoad.style);
        setQuote(projectToLoad.quote);
        setGeneratedImage(projectToLoad.generatedImage);
        setCurrentProjectId(projectToLoad.id);
        setError(null);
        setActiveTab('quote');
        setShowStyleSelector(!!projectToLoad.generatedImage);
        setOverheadPercent(projectToLoad.overheadPercent ?? 10);
        setContingencyPercent(projectToLoad.contingencyPercent ?? 5);
    }
  };
  
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (afterImageRef.current) {
        afterImageRef.current.style.clipPath = `polygon(0 0, ${value}% 0, ${value}% 100%, 0 100%)`;
    }
    if (sliderHandleRef.current) {
        sliderHandleRef.current.style.left = `${value}%`;
    }
  };
  
  const recalculateQuote = (lineItems: LineItem[], disclaimer?: string): Quote => {
      const subtotal = lineItems.reduce((acc, item) => acc + item.total, 0);
      const overhead = subtotal * (overheadPercent / 100);
      const contingency = subtotal * (contingencyPercent / 100);
      const preTaxTotal = subtotal + overhead + contingency;
      const tax = preTaxTotal * (currentTaxRate / 100);
      const grandTotal = preTaxTotal + tax;

      return {
          lineItems,
          summary: {
              subtotal,
              overhead,
              contingency,
              tax,
              grandTotal,
              disclaimer: disclaimer || quote?.summary.disclaimer || "This is a labor-only quote and does not include major materials."
          }
      };
  };

  useEffect(() => {
    if (quote) {
      setQuote(recalculateQuote(quote.lineItems));
    }
  }, [overheadPercent, contingencyPercent, region]);

  const handleItemChange = (index: number, field: keyof LineItem, value: string | number) => {
    if (!quote) return;
    const updatedItems = [...quote.lineItems];
    const itemToUpdate = { ...updatedItems[index] };

    if (field === 'item' || field === 'unit') {
        if (typeof value === 'string') {
            itemToUpdate[field] = value;
        }
    } else {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (!isNaN(numValue)) {
            itemToUpdate[field] = numValue;
        }
    }

    if (field === 'quantity' || field === 'rate') {
      itemToUpdate.total = itemToUpdate.quantity * itemToUpdate.rate;
    } else if (field === 'total') {
      if (itemToUpdate.quantity !== 0) {
        itemToUpdate.rate = itemToUpdate.total / itemToUpdate.quantity;
      }
    }

    updatedItems[index] = itemToUpdate;
    setQuote(recalculateQuote(updatedItems));
  };

  const addManualItem = () => {
    if (!quote) return;
    const newItem: LineItem = { item: 'New Item', quantity: 1, unit: 'each', rate: 0, total: 0 };
    const updatedItems = [...quote.lineItems, newItem];
    setQuote(recalculateQuote(updatedItems));
  };

  const handleRemoveItem = (indexToRemove: number) => {
    if (!quote) return;
    const updatedItems = quote.lineItems.filter((_, index) => index !== indexToRemove);
    setQuote(recalculateQuote(updatedItems));
  };

  const handleBump = (direction: 'up' | 'down') => {
      if (!quote) return;
      const percentage = parseFloat(bumpPercent);
      if (isNaN(percentage)) return;

      const multiplier = direction === 'up' ? 1 + (percentage / 100) : 1 - (percentage / 100);

      const bumpedItems = quote.lineItems.map(item => {
          const newRate = item.rate * multiplier;
          return {
              ...item,
              rate: newRate,
              total: item.quantity * newRate,
          };
      });

      setQuote(recalculateQuote(bumpedItems));
  };

  const exportCSV = () => {
    if (!quote) return;
    const headers = ['Item', 'Quantity', 'Unit', 'Rate', 'Total'];
    const rows = quote.lineItems.map(item => 
      [item.item, item.quantity.toFixed(2), item.unit, item.rate.toFixed(2), item.total.toFixed(2)].join(',')
    );
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(',') + "\n" + rows.join('\n');
    
    // Add summary
    csvContent += "\n\n";
    csvContent += `Subtotal,${quote.summary.subtotal.toFixed(2)}\n`;
    csvContent += `Overhead (${overheadPercent}%),${quote.summary.overhead.toFixed(2)}\n`;
    csvContent += `Contingency (${contingencyPercent}%),${quote.summary.contingency.toFixed(2)}\n`;
    csvContent += `Tax (${currentTaxRate}%),${quote.summary.tax.toFixed(2)}\n`;
    csvContent += `Grand Total,${quote.summary.grandTotal.toFixed(2)}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${projectName}_quote.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const printPDF = () => {
    window.print();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };
  
  return (
    <main className="container">
      <aside className="panel input-panel">
        <header className="panel-header">
            <h1>
                <span className="material-icons-outlined">construction</span>
                AI Renovation Quoter
            </h1>
            <button onClick={toggleTheme} className="theme-toggle-btn" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
                <span className="material-icons-outlined">
                    {theme === 'light' ? 'dark_mode' : 'light_mode'}
                </span>
            </button>
        </header>

        <div className="form-group">
          <Tooltip text="Load a previously saved project. Your projects are stored securely in your browser's local storage.">
            <label htmlFor="saved-projects">Load Project</label>
          </Tooltip>
          <select id="saved-projects" onChange={handleLoadProject} value={currentProjectId || ''}>
              <option value="">-- Start a New Project --</option>
              {savedProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <Tooltip text="Give your project a descriptive name. This will be used for saving and on the final quote and PDF export.">
            <label htmlFor="project-name">Project Name</label>
          </Tooltip>
          <input type="text" id="project-name" className="input" placeholder="e.g., Main Floor Bathroom Reno" value={projectName} onChange={e => setProjectName(e.target.value)} />
        </div>

        <div className="form-group">
          <Tooltip text="Upload a clear, well-lit photo of the room. <br><b>AI Pro Tip:</b> For the most accurate analysis and best renders, use a high-resolution image taken from a corner to show as much space as possible.">
            <label htmlFor="photo-upload">Upload Room Photo</label>
          </Tooltip>
          <div className="file-upload-area" onClick={() => document.getElementById('photo-upload')?.click()}>
            <input type="file" id="photo-upload" accept="image/png, image/jpeg" onChange={handleFileChange} hidden capture="environment"/>
            {filePreview ? (
              <img src={filePreview} alt="Room preview" className="image-preview" />
            ) : (
              <>
                <span className="material-icons-outlined">upload_file</span>
                <p>Click to upload or take a photo</p>
              </>
            )}
          </div>
          {currentProjectId && !file && <small className="field-note">Re-upload photo to generate new results.</small>}
        </div>
        
        <div className="form-group">
            <Tooltip text="Select the room type and metropolitan area. <br><b>AI Pro Tip:</b> This is crucial! The AI researches real, current labor rates and sets the correct local sales tax for your selected region.">
                <label>Room & Location</label>
            </Tooltip>
            <div style={{display: 'flex', gap: '1rem'}}>
                <select value={roomType} onChange={e => setRoomType(e.target.value)}>
                    <option>Kitchen</option>
                    <option>Bathroom</option>
                    <option>Bedroom</option>
                    <option>Other</option>
                </select>
                <select value={region} onChange={e => setRegion(e.target.value as Region)}>
                    <option value="QC_MONTREAL">Montreal, QC</option>
                    <option value="ON_TORONTO">Toronto, ON</option>
                    <option value="NYC">New York, NY</option>
                </select>
            </div>
        </div>

        <div className="form-group">
          <Tooltip text="Describe the renovation in detail. <br><b>AI Pro Tip:</b> Be specific with measurements. Instead of 'new floor', say 'install 250 sq ft of luxury vinyl plank'. The more detail, the more accurate your quote.">
            <label htmlFor="scope">Scope of Work</label>
          </Tooltip>
          <textarea id="scope" placeholder="e.g., Replace laminate with LVP, paint walls/ceiling, add 4 pot lights..." value={scope} onChange={e => setScope(e.target.value)}></textarea>
        </div>

        {showStyleSelector && (
          <div className="form-group">
              <Tooltip text="Choose an aesthetic for the 'after' render. You can regenerate with different styles. <br><b>AI Pro Tip:</b> The style guides the AI on everything from color palettes to fixture choices.">
                <label>Design Style (for "After" Render)</label>
              </Tooltip>
              <div className="radio-group">
                  {(['Modern', 'Farmhouse', 'Scandinavian', 'Industrial', 'Coastal', 'Minimalist', 'Bohemian', 'Mid-Century Modern'] as StylePreset[]).map(s => (
                      <div key={s}>
                          <input type="radio" id={`style-${s}`} name="style" value={s} checked={style === s} onChange={() => setStyle(s)} />
                          <label htmlFor={`style-${s}`}>{s}</label>
                      </div>
                  ))}
              </div>
          </div>
        )}

        <div className="form-actions">
            <div className="button-group">
                <button className="btn" onClick={generateQuote} disabled={isQuoteLoading || isRenderLoading || !file || !scope || !projectName}>
                    {isQuoteLoading ? <div className="loading-spinner"></div> : <span className="material-icons-outlined">request_quote</span>}
                    {isQuoteLoading ? 'Analyzing...' : 'Generate Quote'}
                </button>
                <button className="btn" onClick={generateRender} disabled={isQuoteLoading || isRenderLoading || !file || !scope || !projectName}>
                    {isRenderLoading ? <div className="loading-spinner"></div> : <span className="material-icons-outlined">auto_fix_high</span>}
                    {isRenderLoading ? 'Designing...' : 'Generate Render'}
                </button>
            </div>
            <button className="btn btn-secondary" onClick={saveProject} disabled={isQuoteLoading || isRenderLoading || (!quote && !generatedImage) || !projectName}>
                <span className="material-icons-outlined">save</span>
                Save Project
            </button>
        </div>
      </aside>

      <section className="panel output-panel">
        <div className="printable-area">
          <div className="printable-header">
            <h1>AI Renovation Quoter</h1>
            {projectName && <h2>Estimate for: {projectName}</h2>}
            <p className="printable-date">Date: {new Date().toLocaleDateString()}</p>
          </div>

          {!quote && !generatedImage && !isQuoteLoading && !isRenderLoading && !error && (
              <div className="placeholder">
                  <span className="material-icons-outlined">dynamic_feed</span>
                  <h2>Your Quote & Renders Appear Here</h2>
                  <p>Fill out the form and click a "Generate" button to get started.</p>
              </div>
          )}
          {(isQuoteLoading || isRenderLoading) && (
              <div className="placeholder">
                  <div className="loading-spinner" style={{width: 48, height: 48, borderColor: 'var(--primary-color)', borderTopColor: 'transparent'}}></div>
                  <h2>{isQuoteLoading ? 'Analyzing Quote...' : 'Designing Render...'}</h2>
                  <p>This may take a moment. The AI is hard at work!</p>
              </div>
          )}
          {error && (
              <div className="error-message">
                  <span className="material-icons-outlined">error_outline</span>
                  <h2>Oops! Something went wrong.</h2>
                  <p>{error}</p>
              </div>
          )}
          {(quote || generatedImage) && (
            <>
              <div className="tabs no-print">
                <button className={`tab-btn ${activeTab === 'quote' ? 'active' : ''}`} onClick={() => setActiveTab('quote')} disabled={!quote}>Quote</button>
                <button className={`tab-btn ${activeTab === 'render' ? 'active' : ''}`} onClick={() => setActiveTab('render')} disabled={!generatedImage}>Renders</button>
              </div>
              
              <div id="printable-quote-content" style={{display: activeTab === 'quote' ? 'block' : 'none'}}>
                {quote && (
                  <div className="tab-content">
                    <h2 className="no-print">Estimate for: {projectName}</h2>
                    <table className="quote-table">
                      <thead>
                        <tr>
                          <th style={{width: '40%'}}>Item</th>
                          <th>Quantity</th>
                          <th>Unit</th>
                          <th>Rate</th>
                          <th>Total</th>
                          <th className="remove-col"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {quote.lineItems.map((item, index) => (
                          <tr key={index}>
                            <td data-label="Item"><input type="text" value={item.item} onChange={e => handleItemChange(index, 'item', e.target.value)} className="editable-cell" /></td>
                            <td data-label="Quantity"><input type="number" value={item.quantity.toString()} onChange={e => handleItemChange(index, 'quantity', e.target.value)} className="editable-cell" /></td>
                            <td data-label="Unit"><input type="text" value={item.unit} onChange={e => handleItemChange(index, 'unit', e.target.value)} className="editable-cell" /></td>
                            <td data-label="Rate"><input type="number" value={item.rate.toFixed(2)} onChange={e => handleItemChange(index, 'rate', e.target.value)} className="editable-cell" /></td>
                            <td data-label="Total"><input type="number" value={item.total.toFixed(2)} onChange={e => handleItemChange(index, 'total', e.target.value)} className="editable-cell" /></td>
                            <td className="remove-col" data-label="">
                                <button onClick={() => handleRemoveItem(index)} className="remove-item-btn" title="Remove Item">
                                    <span className="material-icons-outlined">close</span>
                                </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="quote-actions no-print">
                        <button onClick={addManualItem} className="btn btn-secondary">
                          <span className="material-icons-outlined">add</span>
                          Add Line Item
                        </button>
                    </div>

                    <div className="quote-summary">
                        <div className="quote-actions-bottom no-print">
                            <div className="bump-section">
                                <label htmlFor="bump-percent">Adjust Price By</label>
                                <div className="input-group">
                                    <input id="bump-percent" type="number" value={bumpPercent} onChange={e => setBumpPercent(e.target.value)} />
                                    <span>%</span>
                                    <button onClick={() => handleBump('up')}>Up</button>
                                    <button onClick={() => handleBump('down')}>Down</button>
                                </div>
                            </div>
                            <div className="export-section">
                                <button onClick={exportCSV}><span className="material-icons-outlined">download</span> Export as CSV</button>
                                <button onClick={printPDF}><span className="material-icons-outlined">print</span> Print / Save as PDF</button>
                            </div>
                        </div>

                        <p className="disclaimer">{quote.summary.disclaimer}</p>
                        <table className="summary-table">
                            <tbody>
                                <tr><td>Subtotal</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.subtotal)}</td></tr>
                                <tr>
                                    <td>
                                        <div className="summary-label-group" data-percentage={overheadPercent}>
                                            <span>Overhead</span>
                                            <div className="input-group summary-input">
                                                <input type="number" value={overheadPercent} onChange={e => setOverheadPercent(parseFloat(e.target.value) || 0)} />
                                                <span>%</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.overhead)}</td>
                                </tr>
                                <tr>
                                    <td>
                                        <div className="summary-label-group" data-percentage={contingencyPercent}>
                                            <span>Contingency</span>
                                            <div className="input-group summary-input">
                                                <input type="number" value={contingencyPercent} onChange={e => setContingencyPercent(parseFloat(e.target.value) || 0)} />
                                                <span>%</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.contingency)}</td>
                                </tr>
                                <tr>
                                    <td>
                                      <div className="summary-label-group" data-percentage={currentTaxRate}>
                                          <span>Tax</span>
                                          <span className="tax-rate-display">({currentTaxRate}%)</span>
                                      </div>
                                    </td>
                                    <td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.tax)}</td>
                                </tr>
                                <tr className="total"><td>Grand Total</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.grandTotal)}</td></tr>
                            </tbody>
                        </table>
                    </div>
                  </div>
                )}
              </div>
              <div id="printable-render-content" style={{display: activeTab === 'render' ? 'block' : 'none'}}>
                {generatedImage && (
                  <div className="tab-content render-view">
                    <h2 className="no-print">Before & After: {projectName}</h2>
                    {filePreview && generatedImage ? (
                      <div className="before-after-slider">
                        <img src={generatedImage} id="after-image" ref={afterImageRef} alt="After render"/>
                        <img src={filePreview} id="before-image" alt="Before photo"/>
                        <input type="range" id="slider-range" min="0" max="100" defaultValue="50" ref={sliderRef} onChange={handleSliderChange} aria-label="Before/After image slider"/>
                        <div className="slider-handle" ref={sliderHandleRef}>
                            <div className="slider-handle-icon">
                                <span className="material-icons-outlined" style={{transform: 'rotate(90deg)'}}>unfold_more</span>
                            </div>
                        </div>
                      </div>
                    ) : (
                        <p>Render is not available.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);