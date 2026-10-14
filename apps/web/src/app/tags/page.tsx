"use client";

import React, { Suspense } from "react";
import { FilterBar } from "@/components/filter-bar";
import { ContentManagementView } from "@/components/tags/content-management-view";

export default function TagsPage() {
  return (
    <Suspense>
      <FilterBar title="Tags & Categories" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <ContentManagementView />
      </main>
    </Suspense>
  );
}
