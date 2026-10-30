import './App.css';

export default function App() {
  return (
    <iframe
      className="enterprise-frame"
      title="ProcureFlow enterprise procurement"
      src={`${import.meta.env.BASE_URL}enterprise.html`}
    />
  );
}
