import {ArrowRight, Construction, Lock} from 'lucide-react';
import React from 'react';
import {Link} from 'react-router-dom';
import {SectionIcon} from '../components/SectionIcon';
import {APP_SECTIONS} from '../config/navigation';
import {useAuth} from '../context/AuthContext';

interface UnderDevelopmentPageProps {
  path: string;
}

export const UnderDevelopmentPage: React.FC<UnderDevelopmentPageProps> = ({path}) => {
  const {can, session} = useAuth();
  const section = APP_SECTIONS.find((s) => s.path === path);

  if (!section) {
    return null;
  }

  const hasAccess = !section.requiredPermission || can(section.requiredPermission);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-[#0B1F3A] text-[#C9A227] flex items-center justify-center">
          <SectionIcon name={section.iconName} className="w-8 h-8" />
        </div>

        <div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#9E7B14]">
          <Construction className="w-4 h-4" />
          <span>قيد التطوير · مجدول في المرحلة {section.implementedInStage}</span>
        </div>

        <h2 className="mt-2 text-2xl font-bold text-[#0B1F3A]">{section.titleAr}</h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
          {section.descriptionAr}
        </p>

        {!hasAccess && (
          <div className="mt-5 rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs font-semibold text-amber-800 inline-flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              تنبيه: دورك الحالي ({session?.role.nameAr}) لا يمتلك صلاحية تنفيذ عمليات هذا القسم.
            </span>
          </div>
        )}

        <div className="mt-6 rounded-xl bg-slate-50 border border-slate-200 p-4 text-right">
          <p className="text-xs font-bold text-[#0B1F3A] mb-2">
            الجداول المصممة والمجهزة لهذا القسم في IndexedDB:
          </p>
          <p className="text-xs font-mono text-slate-600 leading-relaxed" dir="ltr">
            {section.relatedTables.join(' · ')}
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Link
            to="/"
            className="min-h-[48px] inline-flex items-center gap-2 rounded-xl bg-[#0B1F3A] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#133159] transition-colors"
          >
            <ArrowRight className="w-4 h-4 text-[#C9A227]" />
            <span>العودة إلى الرئيسية</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
