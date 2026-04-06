namespace Pe.Global.Services.Aps.Core;

internal static class OAuthCallbackPages {
    private const string PageStyle = """
                                     body {
                                         font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
                                         display: flex;
                                         flex-direction: column;
                                         justify-content: center;
                                         align-items: center;
                                         min-height: 100vh;
                                         margin: 0;
                                         background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                         color: white;
                                     }
                                     .card {
                                         background: white;
                                         color: #333;
                                         padding: 2rem 3rem;
                                         border-radius: 12px;
                                         box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                                         text-align: center;
                                         min-width: 300px;
                                     }
                                     h2 { margin-bottom: 0.5rem; font-weight: 600; }
                                     .message { color: #666; margin-bottom: 1.5rem; }
                                     .countdown-container {
                                         display: flex;
                                         flex-direction: column;
                                         align-items: center;
                                         gap: 0.5rem;
                                     }
                                     .countdown-ring {
                                         width: 60px;
                                         height: 60px;
                                         border-radius: 50%;
                                         background: conic-gradient(#667eea var(--progress, 100%), #e0e0e0 0%);
                                         display: flex;
                                         align-items: center;
                                         justify-content: center;
                                         transition: --progress 1s linear;
                                     }
                                     .countdown-ring::before {
                                         content: '';
                                         width: 50px;
                                         height: 50px;
                                         background: white;
                                         border-radius: 50%;
                                         position: absolute;
                                     }
                                     .countdown-number {
                                         font-size: 1.5rem;
                                         font-weight: bold;
                                         color: #667eea;
                                         z-index: 1;
                                     }
                                     .countdown-text {
                                         font-size: 0.85rem;
                                         color: #999;
                                     }
                                     .success-icon { color: #22c55e; }
                                     .error-icon { color: #ef4444; }
                                     """;

    private const string CountdownScript = """
                                           <script>
                                               let seconds = 5;
                                               const numberEl = document.getElementById('countdown-number');
                                               const ringEl = document.getElementById('countdown-ring');
                                               const textEl = document.getElementById('countdown-text');
                                               
                                               function forceCloseTab() {
                                                   textEl.textContent = 'Closing...';
                                                   
                                                   // Multiple close strategies - browsers are picky about this
                                                   // Strategy 1: Standard close
                                                   try { window.close(); } catch (e) {}
                                                   
                                                   // Strategy 2: Open self then close (tricks some browsers)
                                                   try { window.open('', '_self', ''); window.close(); } catch (e) {}
                                                   
                                                   // Strategy 3: Replace location then close
                                                   try { open(location, '_self').close(); } catch (e) {}
                                                   
                                                   // If we're still here after 300ms, the browser blocked us
                                                   setTimeout(function() {
                                                       if (!window.closed) {
                                                           textEl.textContent = 'You may close this tab';
                                                       }
                                                   }, 300);
                                               }
                                               
                                               function updateCountdown() {
                                                   if (seconds > 0) {
                                                       numberEl.textContent = seconds;
                                                       ringEl.style.setProperty('--progress', (seconds / 5 * 100) + '%');
                                                       seconds--;
                                                       setTimeout(updateCountdown, 1000);
                                                   } else {
                                                       numberEl.textContent = '0';
                                                       ringEl.style.setProperty('--progress', '0%');
                                                       forceCloseTab();
                                                   }
                                               }
                                               
                                               // Start countdown
                                               updateCountdown();
                                           </script>
                                           """;

    public const string SuccessPage = $$"""
                                        <html>
                                            <head>
                                                <title>Login Success</title>
                                                <style>{{PageStyle}}</style>
                                            </head>
                                            <body>
                                                <div class="card">
                                                    <h2><span class="success-icon">✓</span> Login Successful</h2>
                                                    <p class="message">You're authenticated! Returning to Revit...</p>
                                                    <div class="countdown-container">
                                                        <div class="countdown-ring" id="countdown-ring">
                                                            <span class="countdown-number" id="countdown-number">5</span>
                                                        </div>
                                                        <span class="countdown-text" id="countdown-text">Closing in 5 seconds</span>
                                                    </div>
                                                </div>
                                                {{CountdownScript}}
                                            </body>
                                        </html>
                                        """;

    public const string ErrorPage = $$"""
                                      <html>
                                          <head>
                                              <title>Login Failed</title>
                                              <style>{{PageStyle}}</style>
                                          </head>
                                          <body>
                                              <div class="card">
                                                  <h2><span class="error-icon">✗</span> Login Failed</h2>
                                                  <p class="message">Authentication was denied or an error occurred.<br/>Please try again in Revit.</p>
                                                  <div class="countdown-container">
                                                      <div class="countdown-ring" id="countdown-ring">
                                                          <span class="countdown-number" id="countdown-number">5</span>
                                                      </div>
                                                      <span class="countdown-text" id="countdown-text">Closing in 5 seconds</span>
                                                  </div>
                                              </div>
                                              {{CountdownScript}}
                                          </body>
                                      </html>
                                      """;
}