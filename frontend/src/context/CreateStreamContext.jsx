import { createContext, useContext, useState } from 'react';

const Ctx = createContext(null);

export function CreateStreamProvider({ children }) {
  const [open,    setOpen]    = useState(false);
  const [prefill, setPrefill] = useState({});

  function openModal(data = {}) {
    setPrefill(data?.prefill ?? {});
    setOpen(true);
  }
  function closeModal() {
    setOpen(false);
    setPrefill({});
  }

  return (
    <Ctx.Provider value={{ open, prefill, openModal, closeModal }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCreateStream() {
  return useContext(Ctx);
}
