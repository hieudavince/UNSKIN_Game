import { create } from 'zustand';
import { STARTING_CREDITS } from '../constants/gameConfig';

// Local Buy Phase cart state before it's committed to the server.
// Server (Cloud Function) is the source of truth for actual credit balance —
// this store is just the UI's "shopping cart" during the 45s Buy Phase.
export const useEconomyStore = create((set, get) => ({
  credits: STARTING_CREDITS,
  cart: [], // array of { materialType, cartridgeCount }

  addToCart(materialType, cost) {
    if (get().credits < cost) return false;
    set((s) => ({
      credits: s.credits - cost,
      cart: [...s.cart, { materialType, cost }],
    }));
    return true;
  },

  removeFromCart(index) {
    set((s) => {
      const item = s.cart[index];
      if (!item) return s;
      return {
        credits: s.credits + item.cost,
        cart: s.cart.filter((_, i) => i !== index),
      };
    });
  },

  resetForNewRound(newBalance) {
    set({ credits: newBalance, cart: [] });
  },
}));
