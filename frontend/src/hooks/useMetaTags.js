import { useEffect } from 'react';

export function useMetaTags({
  title = 'CronStream - Programmable Payroll for Contractors & Teams',
  description = 'Milestone-verified payment streams for teams. Contractors earn as work ships with automatic verification.',
  url = 'https://cronstream.xyz',
  image = 'https://cronstream.xyz/og-image.png',
  type = 'website',
} = {}) {
  useEffect(() => {
    // Update title
    document.title = title;

    // Update or create meta tags
    const updateMeta = (name, content, isProperty = false) => {
      let element = document.querySelector(
        isProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`
      );
      if (!element) {
        element = document.createElement('meta');
        isProperty ? element.setAttribute('property', name) : element.setAttribute('name', name);
        document.head.appendChild(element);
      }
      element.content = content;
    };

    // Standard meta
    updateMeta('description', description);

    // Open Graph
    updateMeta('og:type', type, true);
    updateMeta('og:url', url, true);
    updateMeta('og:title', title, true);
    updateMeta('og:description', description, true);
    updateMeta('og:image', image, true);

    // Twitter
    updateMeta('twitter:url', url);
    updateMeta('twitter:title', title);
    updateMeta('twitter:description', description);
    updateMeta('twitter:image', image);

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }, [title, description, url, image, type]);
}
