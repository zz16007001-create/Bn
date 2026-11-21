import {
  Banknote,
  BarChart3,
  Building2,
  Coffee,
  DatabaseBackup,
  Home,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Undo2,
  Users,
  Vault,
  WalletCards,
  Warehouse,
} from 'lucide-react';
import React from 'react';
import type {NavSection} from '../config/navigation';

interface SectionIconProps {
  name: NavSection['iconName'];
  className?: string;
}

export const SectionIcon: React.FC<SectionIconProps> = ({name, className = 'w-5 h-5'}) => {
  switch (name) {
    case 'home':
      return <Home className={className} />;
    case 'shopping_cart':
      return <ShoppingCart className={className} />;
    case 'receipt':
      return <Receipt className={className} />;
    case 'coffee':
      return <Coffee className={className} />;
    case 'warehouse':
      return <Warehouse className={className} />;
    case 'truck':
      return <Truck className={className} />;
    case 'users':
      return <Users className={className} />;
    case 'building':
      return <Building2 className={className} />;
    case 'banknote':
      return <Banknote className={className} />;
    case 'wallet_cards':
      return <WalletCards className={className} />;
    case 'vault':
      return <Vault className={className} />;
    case 'bar_chart':
      return <BarChart3 className={className} />;
    case 'shield_check':
      return <ShieldCheck className={className} />;
    case 'settings':
      return <Settings className={className} />;
    case 'database_backup':
      return <DatabaseBackup className={className} />;
    case 'undo':
      return <Undo2 className={className} />;
  }
};
