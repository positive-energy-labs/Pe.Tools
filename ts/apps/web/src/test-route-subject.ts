import { field, manyField } from '@pe/agent-contracts';
import { z } from 'zod';
// Test routes still enter through real route admission.
export const testSubject = { subjectField: {kind:'singleton' as const, field:'testSubject' as never, noun:'test fixture', keyKind:'name' as const, cardinality:'one' as const, roster:'testSubject',detail:'testSubject',pane:'body',show:(id:string)=>id} };
export const testFields = { testSubject: {...field(z.enum(['fixture']).default('fixture'),{}),role:'subject' as const},testSelected:{...manyField('name',{}),role:'selection' as const} };
export const testReadings = { testSubject:{kind:'derive' as const,source:'testSubject',retire:'never' as const} };

export const testSources = { testSubject: {kind:'derive' as const,derive:()=>['fixture']} };
