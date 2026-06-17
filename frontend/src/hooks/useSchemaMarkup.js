import { useEffect } from 'react';

export function useSchemaMarkup(schema) {
  useEffect(() => {
    if (!schema) return;

    let script = document.querySelector('script[type="application/ld+json"]');
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(schema);
  }, [schema]);
}
