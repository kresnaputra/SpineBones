import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EvaluationReportWindow } from './components/panels/EvaluationReportWindow'
import { connectEvaluationWindow, isEvaluationWindow } from './utils/evaluationWindow'

const connection = connectEvaluationWindow(isEvaluationWindow);
if (import.meta.hot) import.meta.hot.dispose(() => connection.close());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isEvaluationWindow ? <EvaluationReportWindow /> : <App />}
  </StrictMode>,
)
