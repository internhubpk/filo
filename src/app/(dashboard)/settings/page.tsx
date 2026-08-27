'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  User, 
  Palette, 
  Shield, 
  Bell,
  Save,
  Camera,
  Upload,
  CheckCircle,
  AlertCircle,
  Crown,
  Key,
  Globe,
  Mail
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { useFiloSession, useHostname } from '@/hooks/use-session'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile')

  // HYDRATION-SAFE: session comes from the shared external store (empty on
  // server + first render, applied post-mount — no hydration mismatch).
  const sessionUser = useFiloSession().user
  // Hostname for the "Current Session" row; '' until mounted (matches SSR).
  const hostname = useHostname()

  // Editable profile DRAFT. `null` means "no edits yet" and the form derives
  // its values from the session store — avoiding any setState-in-effect
  // cascades while still reflecting the session as soon as it loads.
  const [draftProfile, setDraftProfile] = useState<{
    name: string
    email: string
    bio: string
    company: string
  } | null>(null)
  const profile = draftProfile ?? {
    name: sessionUser?.name ?? '',
    email: sessionUser?.email ?? '',
    bio: '',
    company: '',
  }
  const setProfile = (
    updater: (prev: { name: string; email: string; bio: string; company: string }) => {
      name: string
      email: string
      bio: string
      company: string
    }
  ) => setDraftProfile(updater(profile))
  const [profileSaved, setProfileSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Branding state
  const [branding, setBranding] = useState({
    brandName: '',
    primaryColor: '#3B82F6',
    secondaryColor: '#10B981',
    logoUrl: '',
    footerText: ''
  })
  const [brandingSaved, setBrandingSaved] = useState(false)

  // Security state
  const [passwords, setPasswords] = useState({
    current: '',
    newPassword: '',
    confirm: ''
  })
  const [passwordChanged, setPasswordChanged] = useState(false)

  // Notification state
  const [notifications, setNotifications] = useState({
    email: true,
    generations: true,
    billing: true,
    marketing: false
  })

  const handleSaveProfile = async () => {
    setSaving(true)
    
    // Simulate API call (replace with actual Convex mutation)
    setTimeout(() => {
      setSaving(false)
      setProfileSaved(true)
      
      // Update localStorage
      try {
        const sessionData = localStorage.getItem('filo_session')
        if (sessionData) {
          const session = JSON.parse(sessionData)
          session.user = { ...session.user, name: profile.name }
          localStorage.setItem('filo_session', JSON.stringify(session))
        }
      } catch (e) {
        console.error('Failed to update session:', e)
      }

      setTimeout(() => setProfileSaved(false), 3000)
    }, 1000)
  }

  const handleSaveBranding = async () => {
    setSaving(true)
    
    // Simulate API call (replace with actual Convex mutation)
    setTimeout(() => {
      setSaving(false)
      setBrandingSaved(true)
      setTimeout(() => setBrandingSaved(false), 3000)
    }, 1000)
  }

  const handleChangePassword = async () => {
    if (passwords.newPassword !== passwords.confirm) {
      toast.error('Passwords do not match', 'Please make sure both fields match')
      return
    }
    
    if (passwords.newPassword.length < 6) {
      toast.error('Password too short', 'Password must be at least 6 characters')
      return
    }

    setSaving(true)
    
    // Simulate API call (replace with actual Convex action)
    setTimeout(() => {
      setSaving(false)
      setPasswordChanged(true)
      setPasswords({ current: '', newPassword: '', confirm: '' })
      setTimeout(() => setPasswordChanged(false), 3000)
    }, 1000)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="max-w-4xl">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="branding" className="gap-2">
              <Palette className="h-4 w-4" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="h-4 w-4" />
              Security
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
          </TabsList>

          {/* Profile Tab */}
          <TabsContent value="profile" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Profile Information
                </CardTitle>
                <CardDescription>
                  Update your personal details and public profile
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Avatar */}
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary">
                    {profile.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Camera className="h-4 w-4" />
                      Change Avatar
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      JPG, PNG or GIF. Max size 2MB.
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Form Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      value={profile.name}
                      onChange={(e) => setProfile(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter your name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={profile.email}
                      disabled
                      className="bg-muted"
                    />
                    <p className="text-xs text-muted-foreground">
                      Contact support to change email
                    </p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="company">Company (Optional)</Label>
                    <Input
                      id="company"
                      value={profile.company}
                      onChange={(e) => setProfile(prev => ({ ...prev, company: e.target.value }))}
                      placeholder="Your company name"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      id="bio"
                      value={profile.bio}
                      onChange={(e) => setProfile(prev => ({ ...prev, bio: e.target.value }))}
                      placeholder="Tell us about yourself"
                      rows={3}
                    />
                  </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={saving} className="gap-2">
                    {saving ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>

                {profileSaved && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="h-4 w-4" />
                    Profile saved successfully!
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Branding Tab */}
          <TabsContent value="branding" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Brand Settings
                </CardTitle>
                <CardDescription>
                  Customize how your generated documents look
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="brandName">Brand Name</Label>
                    <Input
                      id="brandName"
                      value={branding.brandName}
                      onChange={(e) => setBranding(prev => ({ ...prev, brandName: e.target.value }))}
                      placeholder="Your brand or company name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="logoUrl">Logo URL</Label>
                    <Input
                      id="logoUrl"
                      value={branding.logoUrl}
                      onChange={(e) => setBranding(prev => ({ ...prev, logoUrl: e.target.value }))}
                      placeholder="https://example.com/logo.png"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryColor">Primary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="primaryColor"
                        type="color"
                        value={branding.primaryColor}
                        onChange={(e) => setBranding(prev => ({ ...prev, primaryColor: e.target.value }))}
                        className="w-16 h-10 p-1"
                      />
                      <Input
                        value={branding.primaryColor}
                        onChange={(e) => setBranding(prev => ({ ...prev, primaryColor: e.target.value }))}
                        className="flex-1"
                      />
                </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secondaryColor">Secondary Color</Label>
                    <div className="flex gap-2">
                      <Input
                        id="secondaryColor"
                        type="color"
                        value={branding.secondaryColor}
                        onChange={(e) => setBranding(prev => ({ ...prev, secondaryColor: e.target.value }))}
                        className="w-16 h-10 p-1"
                      />
                      <Input
                        value={branding.secondaryColor}
                        onChange={(e) => setBranding(prev => ({ ...prev, secondaryColor: e.target.value }))}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="footerText">Footer Text</Label>
                    <Input
                      id="footerText"
                      value={branding.footerText}
                      onChange={(e) => setBranding(prev => ({ ...prev, footerText: e.target.value }))}
                      placeholder="Text to appear in document footers"
                    />
                  </div>
                </div>

                {/* Preview */}
                <div className="border rounded-lg p-4 bg-muted/30">
                  <p className="text-sm font-medium mb-3">Preview</p>
                  <div 
                    className="p-4 rounded border-2"
                    style={{ borderColor: branding.primaryColor }}
                  >
                    <div 
                      className="font-bold text-lg mb-2"
                      style={{ color: branding.primaryColor }}
                    >
                      {branding.brandName || 'Your Brand'}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      This is how your branded documents will look
                    </p>
                    <div 
                      className="mt-4 pt-4 border-t text-xs"
                      style={{ color: branding.secondaryColor }}
                    >
                      {branding.footerText || 'Confidential'}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveBranding} disabled={saving} className="gap-2">
                    <Save className="h-4 w-4" />
                    Save Branding
                  </Button>
                </div>

                {brandingSaved && (
                  <div className="flex items-center gap-2 text-green-600 text-sm">
                    <CheckCircle className="h-4 w-4" />
                    Branding saved successfully!
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security Settings
                </CardTitle>
                <CardDescription>
                  Manage your password and security preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Change Password */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Change Password</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">Current Password</Label>
                      <Input
                        id="currentPassword"
                        type="password"
                        value={passwords.current}
                        onChange={(e) => setPasswords(prev => ({ ...prev, current: e.target.value }))}
                        placeholder="Enter current password"
                      />
                    </div>
                    <div></div>
                    <div className="space-y-2">
                      <Label htmlFor="newPassword">New Password</Label>
                      <Input
                        id="newPassword"
                        type="password"
                        value={passwords.newPassword}
                        onChange={(e) => setPasswords(prev => ({ ...prev, newPassword: e.target.value }))}
                        placeholder="Enter new password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={passwords.confirm}
                        onChange={(e) => setPasswords(prev => ({ ...prev, confirm: e.target.value }))}
                        placeholder="Confirm new password"
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-end">
                    <Button 
                      onClick={handleChangePassword} 
                      disabled={saving || !passwords.current || !passwords.newPassword}
                      className="gap-2"
                    >
                      <Key className="h-4 w-4" />
                      Update Password
                    </Button>
                  </div>

                  {passwordChanged && (
                    <div className="flex items-center gap-2 text-green-600 text-sm">
                      <CheckCircle className="h-4 w-4" />
                      Password changed successfully!
                    </div>
                  )}
                </div>

                <Separator />

                {/* Active Sessions */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Active Sessions</h3>
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded">
                          <Globe className="h-5 w-5 text-green-600" />
                        </div>
                        <div>
                          <p className="font-medium">Current Session</p>
                          <p className="text-sm text-muted-foreground">
                            {hostname} • Now
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="bg-green-100 text-green-700">
                        Active
                      </Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Danger Zone */}
                <div className="space-y-4">
                  <h3 className="font-semibold text-destructive">Danger Zone</h3>
                  <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">Delete Account</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Permanently delete your account and all associated data. This action cannot be undone.
                        </p>
                      </div>
                      <Button variant="destructive" size="sm">
                        Delete Account
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notification Preferences
                </CardTitle>
                <CardDescription>
                  Choose what notifications you want to receive
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {[
                  {
                    key: 'email' as const,
                    icon: Mail,
                    title: 'Email Notifications',
                    description: 'Receive notifications about your account via email'
                  },
                  {
                    key: 'generations' as const,
                    icon: Crown,
                    title: 'Generation Complete',
                    description: 'Get notified when your documents are finished generating'
                  },
                  {
                    key: 'billing' as const,
                    icon: AlertCircle,
                    title: 'Billing Alerts',
                    description: 'Receive alerts about payments, invoices, and subscription changes'
                  },
                  {
                    key: 'marketing' as const,
                    icon: Globe,
                    title: 'Marketing Updates',
                    description: 'Tips, new features, and product updates (optional)'
                  }
                ].map(({ key, icon: Icon, title, description }) => (
                  <div key={key} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{title}</p>
                        <p className="text-sm text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setNotifications(prev => ({ ...prev, [key]: !prev[key] }))}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        notifications[key] ? 'bg-primary' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifications[key] ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}

                <Separator />

                <div className="flex justify-end">
                  <Button className="gap-2">
                    <Save className="h-4 w-4" />
                    Save Preferences
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
