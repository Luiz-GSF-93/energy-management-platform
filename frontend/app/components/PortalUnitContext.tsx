'use client';
import {createContext,useContext} from 'react';
export type PortalUnit={id:string;name:string;installation:string|null;address:string|null};
export type PortalIdentity={organizationId:string;customerId:string;companyName:string;units:PortalUnit[]};
export const PortalUnitContext=createContext<{unitId:string;unitIds:string[];identity:PortalIdentity|null}|null>(null);
export const usePortalUnitScope=()=>useContext(PortalUnitContext);
