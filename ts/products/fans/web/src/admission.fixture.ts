import { module as fans } from "../route.ts";
import { ductsRouteState } from "@pe/duct-systems-contract/ducts";
import { admitModules } from "@pe/ducts-web/admission.test-support";
import { contractOwner } from "@pe/ducts-web/work-owner.test-support";
export const admit = (version = "fans-fixture") => admitModules(contractOwner(ductsRouteState, fans.data.directory), fans, version);
