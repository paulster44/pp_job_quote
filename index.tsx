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
}

type Tab = 'quote' | 'render';
type StylePreset = 'Modern' | 'Farmhouse' | 'Scandinavian' | 'Industrial';
type Theme = 'light' | 'dark';

const App: React.FC = () => {
  const [projectName, setProjectName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [roomType, setRoomType] = useState('Kitchen');
  const [region, setRegion] = useState('ON_TORONTO');
  const [scope, setScope] = useState('');
  const [style, setStyle] = useState<StylePreset>('Modern');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('quote');
  
  const [quote, setQuote] = useState<Quote | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('light');

  const sliderRef = useRef<HTMLInputElement>(null);
  const afterImageRef = useRef<HTMLImageElement>(null);
  const sliderHandleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const storedProjects = localStorage.getItem('renovationProjects');
      if (storedProjects) {
        setSavedProjects(JSON.parse(storedProjects));
      }
      const savedTheme = localStorage.getItem('theme') as Theme || 'light';
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

  const generateQuoteAndRenders = async () => {
    if (!file || !scope || !projectName) {
      setError('Please provide a project name, upload a photo, and describe the scope of work.');
      return;
    }

    setLoading(true);
    setError(null);
    setQuote(null);
    setGeneratedImage(null);
    setActiveTab('quote');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const imagePart = await fileToGenerativePart(file);

      // --- Quote Generation ---
      const quotePrompt = `You are an expert renovation contractor. Before providing rates, perform a deep analysis of current, typical labor costs for licensed and insured tradespeople in the ${region} metropolitan area. The rates must be realistic and competitive for this specific locale.
Analyze the attached image of a ${roomType} and the following scope of work to create a detailed line-item quote. The scope is: "${scope}".

The quote must be for LABOR AND INSTALLATION ONLY. It should cover standard consumables (e.g., screws, caulk) but explicitly exclude the cost of major materials (e.g., flooring, paint, tiles, fixtures).

Provide quantities (sq ft, linear ft, count), unit rates, and totals. Calculate a summary with a 10% overhead, 5% contingency, and 13% tax. The summary must include a disclaimer about this being a labor-only quote.

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

      const quotePromise = ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, { text: quotePrompt }] },
        config: {
          responseMimeType: "application/json",
          responseSchema: quoteSchema,
        },
      });

      // --- Render Generation ---
      const renderPrompt = `Given the attached 'before' image of a ${roomType}, generate a photorealistic 'after' image of the completed renovation. The desired new style is ${style}. The scope of work is: "${scope}". The final image should be a high-quality, photorealistic 'after' shot, showing the finished room from the same perspective as the original photo.`;

      const renderPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [imagePart, { text: renderPrompt }] },
        config: {
          responseModalities: [Modality.IMAGE],
        },
      });

      const [quoteResponse, renderResponse] = await Promise.all([quotePromise, renderPromise]);

      const quoteJson = JSON.parse(quoteResponse.text);
      setQuote(quoteJson);
      
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
      setError(`Failed to generate results. ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const saveProject = () => {
    if (!projectName || !quote || !filePreview || !file) {
        alert("Please generate a quote and provide a project name before saving.");
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
        // Reset form if "-- Select --" is chosen
        setProjectName('');
        setFile(null);
        setFilePreview(null);
        setRoomType('Kitchen');
        setRegion('ON_TORONTO');
        setScope('');
        setStyle('Modern');
        setQuote(null);
        setGeneratedImage(null);
        setCurrentProjectId(null);
        setError(null);
        return;
    }
    
    const projectToLoad = savedProjects.find(p => p.id === projectId);
    if (projectToLoad) {
        setProjectName(projectToLoad.name);
        setFile(null); // Cannot restore file object, user must re-upload to re-generate
        setFilePreview(projectToLoad.filePreview);
        setRoomType(projectToLoad.roomType);
        setRegion(projectToLoad.region);
        setScope(projectToLoad.scope);
        setStyle(projectToLoad.style);
        setQuote(projectToLoad.quote);
        setGeneratedImage(projectToLoad.generatedImage);
        setCurrentProjectId(projectToLoad.id);
        setError(null);
        setActiveTab('quote');
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
            <label htmlFor="saved-projects">Load Project</label>
            <select id="saved-projects" onChange={handleLoadProject} value={currentProjectId || ''}>
                <option value="">-- Start a New Project --</option>
                {savedProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
        </div>

        <div className="form-group">
          <label htmlFor="project-name">1. Project Name</label>
          <input type="text" id="project-name" className="input" placeholder="e.g., Main Floor Bathroom Reno" value={projectName} onChange={e => setProjectName(e.target.value)} />
        </div>

        <div className="form-group">
          <label htmlFor="photo-upload">2. Upload Room Photo</label>
          <div className="file-upload-area" onClick={() => document.getElementById('photo-upload')?.click()}>
            <input type="file" id="photo-upload" accept="image/png, image/jpeg" onChange={handleFileChange} hidden />
            {filePreview ? (
              <img src={filePreview} alt="Room preview" className="image-preview" />
            ) : (
              <>
                <span className="material-icons-outlined">upload_file</span>
                <p>Click to upload or drag & drop</p>
              </>
            )}
          </div>
          {currentProjectId && !file && <small className="field-note">Re-upload photo to generate new results.</small>}
        </div>
        
        <div className="form-group">
            <label>3. Room & Location</label>
            <div style={{display: 'flex', gap: '1rem'}}>
                <select value={roomType} onChange={e => setRoomType(e.target.value)}>
                    <option>Kitchen</option>
                    <option>Bathroom</option>
                    <option>Bedroom</option>
                    <option>Other</option>
                </select>
                <select value={region} onChange={e => setRegion(e.target.value)}>
                    <option value="QC_MONTREAL">Montreal, QC</option>
                    <option value="ON_TORONTO">Toronto, ON</option>
                    <option value="NYC">New York, NY</option>
                </select>
            </div>
        </div>

        <div className="form-group">
          <label htmlFor="scope">4. Scope of Work</label>
          <textarea id="scope" placeholder="e.g., Replace laminate with LVP, paint walls/ceiling, add 4 pot lights..." value={scope} onChange={e => setScope(e.target.value)}></textarea>
        </div>

        <div className="form-group">
            <label>5. Design Style (for "After" Render)</label>
            <div className="radio-group">
                {(['Modern', 'Farmhouse', 'Scandinavian', 'Industrial'] as StylePreset[]).map(s => (
                    <div key={s}>
                        <input type="radio" id={`style-${s}`} name="style" value={s} checked={style === s} onChange={() => setStyle(s)} />
                        <label htmlFor={`style-${s}`}>{s}</label>
                    </div>
                ))}
            </div>
        </div>
        <div className="button-group">
            <button className="btn" onClick={generateQuoteAndRenders} disabled={loading || !file || !scope || !projectName}>
            {loading ? <div className="loading-spinner"></div> : <span className="material-icons-outlined">auto_awesome</span>}
            {loading ? 'Generating...' : 'Generate Quote & Renders'}
            </button>
            <button className="btn btn-secondary" onClick={saveProject} disabled={loading || !quote || !projectName}>
                <span className="material-icons-outlined">save</span>
                Save Project
            </button>
        </div>
      </aside>

      <section className="panel output-panel">
        {!quote && !loading && !error && (
            <div className="placeholder">
                <span className="material-icons-outlined">dynamic_feed</span>
                <h2>Your Quote & Renders Appear Here</h2>
                <p>Fill out the form to get started.</p>
            </div>
        )}
        {loading && (
            <div className="placeholder">
                <div className="loading-spinner" style={{width: 48, height: 48, borderColor: 'var(--primary-color)', borderTopColor: 'transparent'}}></div>
                <h2>Analyzing & Designing...</h2>
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
        {quote && (
          <>
            <div className="tabs">
              <button className={`tab-btn ${activeTab === 'quote' ? 'active' : ''}`} onClick={() => setActiveTab('quote')}>Quote</button>
              <button className={`tab-btn ${activeTab === 'render' ? 'active' : ''}`} onClick={() => setActiveTab('render')}>Renders</button>
            </div>
            
            {activeTab === 'quote' && (
              <div className="tab-content">
                <h2>Estimate for: {projectName}</h2>
                <table className="quote-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Unit</th>
                      <th>Rate</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lineItems.map((item, index) => (
                      <tr key={index}>
                        <td>{item.item}</td>
                        <td>{item.quantity.toFixed(2)}</td>
                        <td>{item.unit}</td>
                        <td>{formatCurrency(item.rate)}</td>
                        <td>{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="quote-summary">
                    <p className="disclaimer">{quote.summary.disclaimer}</p>
                    <table className="summary-table">
                        <tbody>
                            <tr><td>Subtotal</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.subtotal)}</td></tr>
                            <tr><td>Overhead (10%)</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.overhead)}</td></tr>
                            <tr><td>Contingency (5%)</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.contingency)}</td></tr>
                            <tr><td>Tax (13%)</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.tax)}</td></tr>
                            <tr className="total"><td>Grand Total</td><td style={{textAlign: 'right'}}>{formatCurrency(quote.summary.grandTotal)}</td></tr>
                        </tbody>
                    </table>
                </div>
              </div>
            )}
            {activeTab === 'render' && (
              <div className="tab-content render-view">
                <h2>Before & After: {projectName}</h2>
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
          </>
        )}
      </section>
    </main>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);