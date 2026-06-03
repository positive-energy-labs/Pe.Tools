 Note: this file is a idrectly savved resopnse by the agent who created the files in this directory. The implementation/approval status of these steps is entirely separate, Im just saving for posterity because I agree

 # Biggest transitions                                                                                              
                                                                                                                   
  ### 1. Prompt lore → generated capability map                                                                    
                                                                                                                   
  Highest value / medium lift                                                                                      
                                                                                                                   
  Make HostOperationsCatalog.PublicHttp + HostOperationAgentMetadata produce Pea’s default operation map.          
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Generate compact artifact from host ops:                                                                       
      - operation key                                                                                              
      - layer: context/catalog/matrix/detail/resolve/apply                                                         
      - cost tier                                                                                                  
      - active document kind support                                                                               
      - request shape                                                                                              
      - safe default request                                                                                       
      - use/avoid guidance                                                                                         
      - usually-before/after/next ops                                                                              
      - examples                                                                                                   
  - Let Pea inspect that map before choosing host ops.                                                             
  - Add snapshot tests so metadata drift is visible.                                                               
                                                                                                                   
  This is the first “make it real” move.                                                                           
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 2. Raw JSON dumps → compressed projections                                                                   
                                                                                                                   
  Highest value / medium-high lift                                                                                 
                                                                                                                   
  Add a deterministic projection/rendering layer.                                                                  
                                                                                                                   
  Not:                                                                                                             
                                                                                                                   
  ```text                                                                                                          
    host op returns TOON                                                                                           
  ```                                                                                                              
                                                                                                                   
  But:                                                                                                             
                                                                                                                   
  ```text                                                                                                          
    host op JSON DTO → compressed projection → markdown/TOON/compact JSON renderer                                 
  ```                                                                                                              
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Start Pea-local, not a new shared package.                                                                     
  - Support at least:                                                                                              
      - compact markdown                                                                                           
      - compact JSON                                                                                               
      - TOON/TOON-like for uniform rows                                                                            
  - Add renderer tests over real payload fixtures.                                                                 
  - Always include:                                                                                                
      - source operation                                                                                           
      - scope                                                                                                      
      - counts                                                                                                     
      - truncation                                                                                                 
      - diagnostics                                                                                                
      - freshness/provenance                                                                                       
      - zoom paths                                                                                                 
                                                                                                                   
  This prevents compression from becoming “pretty omission.”                                                       
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 3. Operation selection → laddered workflow loop                                                              
                                                                                                                   
  Very high value / medium lift                                                                                    
                                                                                                                   
  Pea should stop thinking in isolated tools and start navigating a ladder:                                        
                                                                                                                   
  ```text                                                                                                          
    context → resolve/catalog → matrix/relation → detail → script/apply                                            
  ```                                                                                                              
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Teach Pea’s host-op path to use:                                                                               
      - current context first                                                                                      
      - operation metadata second                                                                                  
      - detail only after handles/scope exist                                                                      
  - Make operation results suggest next operations from metadata/projection.                                       
  - Add eval scenarios:                                                                                            
      - “what’s visible in this view?”                                                                             
      - “are these elements scheduled?”                                                                            
      - “what parameter does this office use for equipment mark?”                                                  
      - “show panel schedule detail for this panel”                                                                
  - Use black-box talk_to_pea to check whether Pea actually routes correctly.                                      
                                                                                                                   
  This is where the product starts feeling intelligent.                                                            
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 4. Mixed request shapes → common Revit data envelope                                                         
                                                                                                                   
  High value / high lift                                                                                           
                                                                                                                   
  New Revit ops should converge around:                                                                            
                                                                                                                   
  ```text                                                                                                          
    Filter / Scope / References / Projection / Budget / Options                                                    
  ```                                                                                                              
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Keep existing wrappers where stable.                                                                           
  - For new RevitData ops, require the common envelope unless there is a strong exception.                         
  - Gradually migrate obvious query-wrapper shapes when touched.                                                   
  - Add strict validation and actionable diagnostics.                                                              
  - Ensure C# client methods hide complexity with good names/docs/examples.                                        
                                                                                                                   
  This is not urgent before the MVP, but it matters a lot long-term.                                               
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 5. C# client ergonomics → blessed workflow surface                                                           
                                                                                                                   
  High value / medium lift                                                                                         
                                                                                                                   
  The C# client is already close. Keep it hand-maintained.                                                         
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Preserve the Context / Catalog / Matrix / Detail / Resolve structure.                                          
  - Add blessed methods only for stable, high-value workflows.                                                     
  - Improve XML docs where metadata says “usually after/before.”                                                   
  - Add request factory helpers only where request construction is genuinely awkward.                              
  - Keep ExecuteAsync<TRequest,TResponse> as the escape hatch.                                                     
                                                                                                                   
  Do not generate a giant C# wrapper universe.                                                                     
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 6. Schedule/parameter/electrical domains → first compressed maps                                             
                                                                                                                   
  Very high value / high lift                                                                                      
                                                                                                                   
  These are the best first real Revit domains.                                                                     
                                                                                                                   
  #### Schedule map                                                                                                
                                                                                                                   
  Use existing/current shapes:                                                                                     
                                                                                                                   
  - schedule catalog                                                                                               
  - duplicate-normalized names                                                                                     
  - field fingerprints                                                                                             
  - placements                                                                                                     
  - filters                                                                                                        
  - detail rows                                                                                                    
  - coverage matrix                                                                                                
                                                                                                                   
  Key rule: catalog/detail/coverage stay separate.                                                                 
                                                                                                                   
  #### Parameter map                                                                                               
                                                                                                                   
  Use:                                                                                                             
                                                                                                                   
  - bindings                                                                                                       
  - concept evidence                                                                                               
  - parameter evidence                                                                                             
  - parameter coverage                                                                                             
  - requested element parameters                                                                                   
                                                                                                                   
  Key rule: no name-only guessing unless explicitly marked as fallback.                                            
                                                                                                                   
  #### Electrical map                                                                                              
                                                                                                                   
  Use:                                                                                                             
                                                                                                                   
  - element detail first                                                                                           
  - panel/circuit candidates second                                                                                
  - panel schedule detail last                                                                                     
                                                                                                                   
  Key rule: don’t scan all circuits/panel schedules before candidates exist.                                       
                                                                                                                   
  This is probably the highest user-visible product value.                                                         
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 7. Trust primitives → non-negotiable compression contract                                                    
                                                                                                                   
  High value / medium lift                                                                                         
                                                                                                                   
  Every compressed view needs to answer:                                                                           
                                                                                                                   
  - What document/view/scope is this from?                                                                         
  - Is it fresh?                                                                                                   
  - Was it truncated?                                                                                              
  - What budget was applied?                                                                                       
  - What diagnostics exist?                                                                                        
  - What handles can I zoom into?                                                                                  
  - What operation produced this?                                                                                  
  - What operation should come next?                                                                               
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Standardize a tiny compressed projection header.                                                               
  - Fail tests if compressed outputs omit truncation/provenance/freshness.                                         
  - Ensure every follow-up path is executable, not prose-only.                                                     
                                                                                                                   
  This is the difference between “compression” and “agent-safe compression.”                                       
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 8. Evaluation harness → prove Pea got smarter                                                                
                                                                                                                   
  High value / medium lift                                                                                         
                                                                                                                   
  We need proof beyond “the artifact looks nice.”                                                                  
                                                                                                                   
  Concrete work:                                                                                                   
                                                                                                                   
  - Snapshot tests for generated maps.                                                                             
  - Token-count comparisons:                                                                                       
      - JSON vs compact markdown vs TOON.                                                                          
  - Semantic round-trip tests for TOON-supported shapes.                                                           
  - Routing evals:                                                                                                 
      - expected operation sequence for realistic user questions.                                                  
  - Black-box Pea tests:                                                                                           
      - ask normal BIM-manager/operator questions, not tool-shaped prompts.                                        
                                                                                                                   
  This should become the safety net before expanding the system.                                                   
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 9. DuckDB/Parquet discovery cache                                                                            
                                                                                                                   
  Medium value now / very high lift                                                                                
                                                                                                                   
  Valuable later, not first.                                                                                       
                                                                                                                   
  Use when we want:                                                                                                
                                                                                                                   
  - cross-model schedule/family/parameter analytics                                                                
  - APS/DA artifact collections                                                                                    
  - persistent project inventory                                                                                   
  - offline dashboards                                                                                             
  - queryable historical snapshots                                                                                 
                                                                                                                   
  Do not put DuckDB in the live Revit bridge path.                                                                 
                                                                                                                   
  This is a future “large data substrate,” not the MVP.                                                            
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  ### 10. JSON Schema tooling upgrade                                                                              
                                                                                                                   
  Medium value / medium-high lift                                                                                  
                                                                                                                   
  Use selectively.                                                                                                 
                                                                                                                   
  Good targets:                                                                                                    
                                                                                                                   
  - settings/profile validation                                                                                    
  - generated schema docs                                                                                          
  - schema zoom paths                                                                                              
  - LSP/editor authoring                                                                                           
  - structured model-output fallback                                                                               
                                                                                                                   
  Bad target:                                                                                                      
                                                                                                                   
  - replacing RevitData DTOs                                                                                       
  - encoding Revit semantics in schema alone                                                                       
                                                                                                                   
  This is support infrastructure, not the main architecture.                                                       
                                                                                                                   
  ────────────────────────────────────────────────────────────────────────────────                                 
                                                                                                                   
  Highest-value MVP path                                                                                           
                                                                                                                   
  If I were sequencing this:                                                                                       
                                                                                                                   
  1. Generate compressed host capability map from HostOperationsCatalog.PublicHttp.                                
  2. Add Pea-side compressed renderer with compact markdown first, TOON second.                                    
  3. Wire Pea to use the map for host-op selection.                                                                
  4. Add evals for operation routing.                                                                              
  5. Add first real Revit maps: schedules + parameters.                                                            
  6. Use talk_to_pea as black-box product feedback.                                                                
  7. Only then decide whether to promote projection code into shared packages.                                     
                                                                                                                   
  Highest-lift strategic refactors                                                                                 
                                                                                                                   
  These are the big ones:                                                                                          
                                                                                                                   
  1. Normalize Revit request shapes around common envelopes.                                                       
  2. Make operation metadata exhaustive enough that Pea does not need prompt lore.                                 
  3. Create compressed Revit summary/projection contracts without bloating public DTOs.                            
  4. Build reliable Pea routing/eval harnesses.                                                                    
  5. Eventually create persistent discovery caches for cross-document analytics.                                   
                                                                                                                   
  Things I would explicitly not do first                                                                           
                                                                                                                   
  - Don’t make host ops return TOON.                                                                               
  - Don’t add one Pea tool per Revit operation.                                                                    
  - Don’t build DuckDB/Parquet before we have repeated persisted-data questions.                                   
  - Don’t refactor every request shape before proving the compressed map.                                          
  - Don’t create a shared compression package until at least Pea + one other surface need it.                      
                                                                                                                   
  Best first concrete milestone:                                                                                   
                                                                                                                   
  │ Pea can answer “what operation should I call next?” from a generated compressed host-operation map, with no    
  │ hardcoded Revit operation inventory in the prompt.
